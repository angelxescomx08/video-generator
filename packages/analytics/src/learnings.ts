import { db, learningDimensions, publishedVideos, videoDimensionLabels, videoStats, videos } from "@video-generator/db";
import type {
  DimensionCoverage,
  DimensionStatus,
  PerformanceBucket,
  PerformanceLearning,
} from "@video-generator/types";
import { MIN_DAYS_FOR_LEARNING, MIN_VIEWS_FOR_LEARNING } from "@video-generator/types";
import { desc, eq, sql } from "drizzle-orm";
import { extractVideoAttributes, type VideoAttributes } from "./video-attributes";

/**
 * Motor de aprendizaje GLOBAL: cruza los atributos de cada video publicado (gancho, ritmo, numero de
 * escenas, musica...) contra como le fue, sobre TODO el canal y no solo sobre un tema.
 *
 * Por que global y por que deterministico:
 * - Global, porque "los ganchos con pregunta retienen mas" no es una verdad del tema "historia", es
 *   una verdad de como funciona la atencion en Shorts. Restringirlo por tema tira la mayor parte de
 *   la muestra justo cuando el canal es chico y cada dato cuenta.
 * - Deterministico (agregacion en SQL/JS, no embeddings), porque una correlacion se calcula, no se
 *   recuerda por similitud semantica. Ademas asi el resultado siempre esta fresco y trae su tamano
 *   de muestra, que es lo que permite al prompt distinguir un patron solido de una casualidad.
 *
 * Vive en un paquete compartido y no en el worker porque tiene dos consumidores: el prompt del
 * guion (apps/worker) y la pantalla de analiticas (apps/web), que le muestra al usuario exactamente
 * las mismas lecciones que se le estan pasando al modelo.
 */

/**
 * Muestra EFECTIVA minima por grupo para comparar (ver `PerformanceBucket.effectiveCount`).
 *
 * Se mide en muestra efectiva y no en videos crudos porque desde que los videos pesan distinto las
 * dos cosas dejaron de ser lo mismo: tres videos viejos detras de uno reciente no sostienen una
 * comparacion, aunque cuenten tres. Como `effectiveCount <= count` siempre, este umbral tambien
 * garantiza el minimo de 3 videos reales que habia antes.
 */
const MIN_SAMPLES_PER_BUCKET = 3;

/**
 * Vida media de los pesos, EN VIDEOS (no en dias): cada `halfLife` videos hacia atras, un video pesa
 * la mitad. Se acota entre estos dos limites.
 *
 * Va por posicion y no por fecha a proposito. Un canal que publica en rachas —tres videos en una
 * semana y luego un mes parado— haria que el decaimiento por calendario castigara a toda una racha
 * por igual, cuando lo que importa es "que tan atras en tu historial esta esto".
 */
const HALF_LIFE_MIN_VIDEOS = 4;
const HALF_LIFE_MAX_VIDEOS = 15;

/**
 * La vida media crece con el tamano del canal, pero con tope.
 *
 * Es el compromiso central de ponderar por recencia: una ventana corta se adapta rapido pero se
 * queda sin datos, y una larga tiene datos pero tarda en notar un cambio. Con pocos videos no se
 * puede permitir descartar nada (de ahi el piso), y con muchos si conviene que lo viejo pese poco
 * (de ahi el techo, que convierte esto en una ventana movil de ~15 videos por mucho que crezca el
 * canal). En medio, `n/2` mantiene la forma de la curva estable mientras el canal es chico.
 */
function halfLifeFor(sampleCount: number): number {
  return Math.min(HALF_LIFE_MAX_VIDEOS, Math.max(HALF_LIFE_MIN_VIDEOS, sampleCount / 2));
}

/**
 * Peso de cada muestra por su posicion en el historial (0 = el mas reciente).
 *
 * Nadie llega a cero: el video mas viejo de un canal grande pesa ~0.1, no 0. Descartar de golpe
 * convertiria cada publicacion en un salto en las lecciones, y con muestras de este tamano eso se
 * ve como si el patron cambiara cuando lo unico que cambio fue quien entra en la ventana.
 */
function recencyWeights(sampleCount: number): number[] {
  const halfLife = halfLifeFor(sampleCount);
  return Array.from({ length: sampleCount }, (_, rank) => 0.5 ** (rank / halfLife));
}

/**
 * Tamano de muestra efectivo de Kish: `(Σw)²/Σw²`.
 *
 * Con pesos iguales devuelve exactamente n; mientras mas desparejos, mas baja. Es la forma estandar
 * de responder "¿cuanta muestra me queda de verdad despues de ponderar?", que es justo lo que hay
 * que vigilar para que dar mas peso a lo reciente no acabe sosteniendo lecciones sobre un video.
 */
function effectiveSampleSize(weights: number[]): number {
  if (weights.length === 0) return 0;
  const sum = weights.reduce((total, w) => total + w, 0);
  const sumSquares = weights.reduce((total, w) => total + w * w, 0);
  return sumSquares === 0 ? 0 : (sum * sum) / sumSquares;
}

/** Diferencia minima en puntos porcentuales para que valga la pena mencionar el patron. */
const MIN_DELTA_POINTS = 5;

/** Cuantas lecciones se pasan al prompt como maximo, de mayor a menor diferencia. */
const MAX_LEARNINGS = 6;

interface Outcomes {
  /** % que seguia viendo cerca del inicio — califica el gancho. */
  retentionAtStart?: number;
  /** % medio del video visto — califica la estructura completa. */
  avgViewPercentage?: number;
}

export interface LearningSample {
  videoId: string;
  attrs: VideoAttributes;
  outcomes: Outcomes;
  /** Peso por recencia (1 el mas reciente, decayendo hacia atras). Ver `recencyWeights`. */
  weight: number;
  /** Etiquetas de las dimensiones descubiertas por la IA, por id de dimension. */
  discovered: Record<string, string>;
}

/**
 * Una dimension a analizar: como agrupar los videos y con que metrica calificar ese grupo. La
 * metrica no es intercambiable — el tipo de gancho se juzga por la retencion inicial, mientras que el
 * numero de escenas se juzga por el porcentaje total visto. Cruzarlas daria conclusiones falsas.
 *
 * Esta es la variante escrita a mano: agrupa mirando los atributos derivados del video.
 *
 * Convive con las dimensiones DESCUBIERTAS (`learning_dimensions`), que agrupan por una etiqueta que
 * un LLM le puso al guion. Las dos terminan siendo el mismo contrato (`Dimension`) para que el resto
 * del motor no tenga que saber de donde salio cada pregunta: se promedian, se filtran por muestra y
 * se comparan exactamente igual. Esa uniformidad es lo que hace seguro dejar que la IA proponga
 * preguntas — una hipotesis mala no tiene un camino especial, pasa por el mismo filtro que todo.
 */
interface AttributeDimension {
  label: string;
  outcome: keyof Outcomes;
  outcomeLabel: string;
  /** Devuelve el nombre del grupo, o null para excluir el video de esta dimension. */
  bucket: (attrs: VideoAttributes) => string | null;
}

/** Una dimension ya normalizada, venga del codigo o de la base. */
interface Dimension {
  label: string;
  outcome: keyof Outcomes;
  outcomeLabel: string;
  bucket: (sample: LearningSample) => string | null;
}

/** Una pregunta descubierta por la IA, tal como se guardo en `learning_dimensions`. */
export interface DiscoveredDimension {
  id: string;
  label: string;
  outcome: keyof Outcomes;
}

const OUTCOME_LABELS: Record<keyof Outcomes, string> = {
  retentionAtStart: "retencion en los primeros segundos",
  avgViewPercentage: "porcentaje del video visto",
};

/** Junta las dos familias de dimensiones bajo el mismo contrato. */
function allDimensions(discovered: DiscoveredDimension[]): Dimension[] {
  return [
    ...DIMENSIONS.map((d) => ({ ...d, bucket: (sample: LearningSample) => d.bucket(sample.attrs) })),
    ...discovered.map((d) => ({
      label: d.label,
      outcome: d.outcome,
      outcomeLabel: OUTCOME_LABELS[d.outcome],
      bucket: (sample: LearningSample) => sample.discovered[d.id] ?? null,
    })),
  ];
}

const DIMENSIONS: readonly AttributeDimension[] = [
  {
    label: "tipo de gancho",
    outcome: "retentionAtStart",
    outcomeLabel: "retencion en los primeros segundos",
    bucket: (a) => (a.hookText === null ? null : a.hookIsQuestion ? "abrir con pregunta" : "abrir con afirmacion"),
  },
  {
    label: "longitud del gancho",
    outcome: "retentionAtStart",
    outcomeLabel: "retencion en los primeros segundos",
    bucket: (a) => (a.hookText === null ? null : a.hookWordCount <= 8 ? "gancho de <=8 palabras" : "gancho de >8 palabras"),
  },
  {
    label: "numero de escenas",
    outcome: "avgViewPercentage",
    outcomeLabel: "porcentaje del video visto",
    bucket: (a) => {
      if (a.sceneCount === 0) return null;
      if (a.sceneCount <= 5) return "hasta 5 escenas";
      if (a.sceneCount <= 9) return "6-9 escenas";
      return "10 o mas escenas";
    },
  },
  {
    label: "ritmo de narracion",
    outcome: "avgViewPercentage",
    outcomeLabel: "porcentaje del video visto",
    bucket: (a) => {
      if (a.wordsPerSecond === null) return null;
      if (a.wordsPerSecond < 2.0) return "ritmo lento (<2 palabras/s)";
      if (a.wordsPerSecond <= 2.6) return "ritmo natural (2-2.6 palabras/s)";
      return "ritmo rapido (>2.6 palabras/s)";
    },
  },
  {
    label: "duracion",
    outcome: "avgViewPercentage",
    outcomeLabel: "porcentaje del video visto",
    bucket: (a) => {
      if (a.durationSeconds === null) return null;
      if (a.durationSeconds <= 30) return "hasta 30s";
      if (a.durationSeconds <= 60) return "31-60s";
      if (a.durationSeconds <= 120) return "61-120s";
      return "mas de 120s";
    },
  },
  {
    label: "musica de fondo",
    outcome: "avgViewPercentage",
    outcomeLabel: "porcentaje del video visto",
    bucket: (a) => (a.hasMusic ? "con musica de fondo" : "sin musica de fondo"),
  },
  {
    // Distinta pregunta que "musica de fondo": ahi se compara musica contra silencio, aqui se compara
    // un tipo de musica contra otro. Se califica por el video completo y no por el gancho porque el
    // mood no decide el primer segundo, decide si te quedas cuando la historia se pone lenta.
    label: "tipo de musica",
    outcome: "avgViewPercentage",
    outcomeLabel: "porcentaje del video visto",
    bucket: (a) => (a.musicMood === null ? null : `musica ${a.musicMood}`),
  },
  // Las tres dimensiones visuales que siguen salen de la guia de retencion para formato corto: el
  // espectador se despega cuando la imagen deja de cambiar, asi que lo que se mide es cada cuanto
  // cambia algo en pantalla y con que fuerza abre el video. Son ademas las unicas decisiones de
  // montaje que sobreviven al render (los tiempos y clips los reescribe el worker, y las
  // transiciones todavia no se aplican).
  {
    label: "variedad visual",
    outcome: "avgViewPercentage",
    outcomeLabel: "porcentaje del video visto",
    bucket: (a) => {
      if (a.effectVariety === 0) return null;
      return a.effectVariety === 1 ? "un solo efecto en todo el video" : "2 o mas efectos distintos";
    },
  },
  {
    // El corte es el pattern interrupt mas barato que existe: no cuesta un clip nuevo, solo decidir
    // cambiar de plano antes. Los cortes de referencia en Shorts caen entre 3 y 5s por plano.
    label: "ritmo de corte",
    outcome: "avgViewPercentage",
    outcomeLabel: "porcentaje del video visto",
    bucket: (a) => {
      if (a.avgSceneSeconds === null) return null;
      if (a.avgSceneSeconds <= 4) return "cortes rapidos (<=4s por escena)";
      if (a.avgSceneSeconds <= 7) return "cortes medios (4-7s por escena)";
      return "cortes lentos (>7s por escena)";
    },
  },
  {
    label: "golpe visual en el gancho",
    outcome: "retentionAtStart",
    outcomeLabel: "retencion en los primeros segundos",
    bucket: (a) => {
      if (a.hookEffect === null) return null;
      return a.hookEffect === "zoom_punch" ? "gancho con golpe visual" : "gancho sin golpe visual";
    },
  },
  {
    // Un dato concreto en el gancho es una promesa de valor inmediata; el "slow build" que abre
    // dando contexto es el error mas repetido en formato corto.
    label: "dato concreto en el gancho",
    outcome: "retentionAtStart",
    outcomeLabel: "retencion en los primeros segundos",
    bucket: (a) =>
      a.hookText === null ? null : a.hookHasNumber ? "gancho con numero/dato" : "gancho sin numero/dato",
  },
  {
    label: "subtitulos",
    outcome: "avgViewPercentage",
    outcomeLabel: "porcentaje del video visto",
    bucket: (a) => (a.captionsEnabled ? "con subtitulos quemados" : "sin subtitulos"),
  },
];

/**
 * Devuelve las lecciones que se sostienen con datos de todo el canal, ordenadas por cuanto separan
 * al mejor grupo del peor. Lista vacia mientras no haya muestra suficiente — es lo correcto: sin
 * datos es mejor no decirle nada al modelo que darle una correlacion de dos videos.
 */
export async function getPerformanceLearnings(): Promise<PerformanceLearning[]> {
  const [samples, discovered] = await Promise.all([loadLearningSamples(), loadDiscoveredDimensions()]);
  return analyzeLearnings(samples, discovered);
}

export interface LearningsReport {
  learnings: PerformanceLearning[];
  coverage: DimensionCoverage[];
  /** Videos medibles detras de todo el reporte. Es la medida de cuanta confianza merece. */
  sampleCount: number;
}

/**
 * Lecciones + diagnostico de cada dimension, cargando las muestras UNA sola vez.
 *
 * La pantalla necesita las dos cosas juntas, y son dos vistas de la misma pasada: pedirlas por
 * separado significaria repetir el `DISTINCT ON` sobre `video_stats` (que crece sin techo) para
 * recorrer en JS exactamente las mismas filas.
 */
export async function getLearningsReport(): Promise<LearningsReport> {
  const [samples, discovered] = await Promise.all([loadLearningSamples(), loadDiscoveredDimensions()]);
  return {
    learnings: analyzeLearnings(samples, discovered),
    coverage: analyzeCoverage(samples, discovered),
    sampleCount: samples.length,
  };
}

/**
 * La parte pura: dadas las muestras, saca las lecciones. Separada de la carga para poder testearla
 * sin base de datos, y para que la UI pueda reutilizar las mismas muestras que ya trajo.
 */
export function analyzeLearnings(samples: LearningSample[], discovered: DiscoveredDimension[] = []): PerformanceLearning[] {
  const learnings: PerformanceLearning[] = [];
  for (const dimension of allDimensions(discovered)) {
    const learning = analyzeDimension(dimension, samples);
    if (learning) learnings.push(learning);
  }
  return learnings.sort((a, b) => b.deltaPoints - a.deltaPoints).slice(0, MAX_LEARNINGS);
}

/**
 * Un snapshot por video publicado (el mas reciente), ya filtrado a los que son senal utilizable.
 * Los descartes son deliberados: un video de dos dias todavia se esta distribuyendo y uno con 30
 * vistas da porcentajes que se mueven entero con un solo espectador.
 *
 * El "mas reciente por video" se resuelve con `DISTINCT ON` en Postgres y no en JS: la version
 * anterior traia TODOS los snapshots historicos de TODOS los videos para quedarse con uno de cada
 * grupo, lo que a mil videos son cientos de miles de filas (con su `raw_payload` y su curva de
 * retencion) cruzando la red en cada generacion de guion. Ahora la base devuelve una fila por
 * video, y el indice `video_stats_published_captured_idx` la encuentra sin ordenar la tabla entera.
 */
export async function loadLearningSamples(): Promise<LearningSample[]> {
  const rows = await db
    .selectDistinctOn([videoStats.publishedVideoId], {
      videoAgeDays: videoStats.videoAgeDays,
      views: videoStats.views,
      engagedViews: videoStats.engagedViews,
      avgViewPercentage: videoStats.avgViewPercentage,
      retentionAtStartPercentage: videoStats.retentionAtStartPercentage,
      publishedAt: publishedVideos.publishedAt,
      video: videos,
    })
    .from(videoStats)
    .innerJoin(publishedVideos, eq(videoStats.publishedVideoId, publishedVideos.id))
    .innerJoin(videos, eq(publishedVideos.videoId, videos.id))
    .where(eq(publishedVideos.status, "published"))
    .orderBy(videoStats.publishedVideoId, desc(videoStats.capturedAt));

  // El ORDER BY de arriba lo fija `DISTINCT ON` (tiene que empezar por la columna distinguida), asi
  // que el orden por recencia se hace aqui — sobre una fila por video, no sobre el historico.
  const usable = rows
    .filter((row) => {
      const sampleSize = row.engagedViews ?? row.views ?? 0;
      if (sampleSize < MIN_VIEWS_FOR_LEARNING) return false;
      if (row.videoAgeDays !== null && row.videoAgeDays < MIN_DAYS_FOR_LEARNING) return false;
      return row.retentionAtStartPercentage !== null || row.avgViewPercentage !== null;
    })
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  // Las etiquetas de las dimensiones descubiertas van en una sola consulta para todo el canal: son
  // (videos publicados x dimensiones activas) filas, un orden de magnitud menor que `video_stats`, y
  // pedirlas por video seria una consulta por video en cada render de analiticas.
  const labelRows = await db
    .select({
      videoId: videoDimensionLabels.videoId,
      dimensionId: videoDimensionLabels.dimensionId,
      bucket: videoDimensionLabels.bucket,
    })
    .from(videoDimensionLabels)
    .innerJoin(learningDimensions, eq(videoDimensionLabels.dimensionId, learningDimensions.id))
    .where(eq(learningDimensions.status, "active"));

  const labelsByVideo = new Map<string, Record<string, string>>();
  for (const row of labelRows) {
    const existing = labelsByVideo.get(row.videoId) ?? {};
    existing[row.dimensionId] = row.bucket;
    labelsByVideo.set(row.videoId, existing);
  }

  const weights = recencyWeights(usable.length);
  return usable.map((row, rank) => ({
    videoId: row.video.id,
    attrs: extractVideoAttributes(row.video),
    outcomes: {
      retentionAtStart: toNumber(row.retentionAtStartPercentage),
      avgViewPercentage: toNumber(row.avgViewPercentage),
    },
    weight: weights[rank]!,
    discovered: labelsByVideo.get(row.video.id) ?? {},
  }));
}

/** Las preguntas que la IA descubrio y siguen activas. */
export async function loadDiscoveredDimensions(): Promise<DiscoveredDimension[]> {
  const rows = await db
    .select({ id: learningDimensions.id, label: learningDimensions.label, outcome: learningDimensions.outcome })
    .from(learningDimensions)
    .where(eq(learningDimensions.status, "active"));
  return rows.map((r) => ({ id: r.id, label: r.label, outcome: r.outcome as keyof Outcomes }));
}

export interface LearningReadiness {
  publishedVideos: number;
  usableSamples: number;
  minViews: number;
  minDays: number;
}

/**
 * Cuantos videos publicados hay contra cuantos pasan el filtro de muestra utilizable.
 *
 * Es lo que la UI necesita para explicar un tablero vacio: "todavia no hay lecciones" y "no hay
 * lecciones porque solo 2 de tus 9 videos llevan los dias suficientes" son dos mensajes distintos, y
 * solo el segundo dice que hacer. Se resuelve con dos contadores agregados, sin traer ninguna fila.
 */
export async function getLearningReadiness(): Promise<LearningReadiness> {
  const latest = db
    .selectDistinctOn([videoStats.publishedVideoId], {
      publishedVideoId: videoStats.publishedVideoId,
      videoAgeDays: videoStats.videoAgeDays,
      views: videoStats.views,
      engagedViews: videoStats.engagedViews,
      avgViewPercentage: videoStats.avgViewPercentage,
      retentionAtStartPercentage: videoStats.retentionAtStartPercentage,
    })
    .from(videoStats)
    .innerJoin(publishedVideos, eq(videoStats.publishedVideoId, publishedVideos.id))
    .where(eq(publishedVideos.status, "published"))
    .orderBy(videoStats.publishedVideoId, desc(videoStats.capturedAt))
    .as("latest");

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      usable: sql<number>`count(*) filter (
        where coalesce(${latest.engagedViews}, ${latest.views}, 0) >= ${MIN_VIEWS_FOR_LEARNING}
          and coalesce(${latest.videoAgeDays}, ${MIN_DAYS_FOR_LEARNING}) >= ${MIN_DAYS_FOR_LEARNING}
          and (${latest.retentionAtStartPercentage} is not null or ${latest.avgViewPercentage} is not null)
      )::int`,
    })
    .from(latest);

  return {
    publishedVideos: row?.total ?? 0,
    usableSamples: row?.usable ?? 0,
    minViews: MIN_VIEWS_FOR_LEARNING,
    minDays: MIN_DAYS_FOR_LEARNING,
  };
}

/** Una observacion dentro de un grupo: el valor de la metrica y cuanto pesa por ser reciente. */
interface WeightedValue {
  value: number;
  weight: number;
}

/** Reparte las muestras en los grupos de una dimension, sin filtrar por tamano todavia. */
function bucketize(dimension: Dimension, samples: LearningSample[]): Map<string, WeightedValue[]> {
  const buckets = new Map<string, WeightedValue[]>();
  for (const sample of samples) {
    const outcome = sample.outcomes[dimension.outcome];
    if (outcome === undefined) continue;
    const key = dimension.bucket(sample);
    if (key === null) continue;
    const list = buckets.get(key) ?? [];
    list.push({ value: outcome, weight: sample.weight });
    buckets.set(key, list);
  }
  return buckets;
}

/** Resume un grupo: promedio ponderado por recencia, videos crudos y muestra efectiva. */
function summarizeBucket(label: string, values: WeightedValue[]): PerformanceBucket {
  const weights = values.map((v) => v.weight);
  return {
    label,
    mean: weightedMean(values),
    count: values.length,
    effectiveCount: effectiveSampleSize(weights),
  };
}

/** Los grupos con muestra efectiva suficiente, ya promediados y ordenados de mejor a peor. */
function usableBuckets(buckets: Map<string, WeightedValue[]>): PerformanceBucket[] {
  return [...buckets.entries()]
    .map(([label, values]) => summarizeBucket(label, values))
    .filter((bucket) => bucket.effectiveCount >= MIN_SAMPLES_PER_BUCKET)
    .sort((a, b) => b.mean - a.mean);
}

/**
 * Por que cada dimension esta o no produciendo una leccion.
 *
 * Se calcula sobre las mismas muestras que `analyzeLearnings`, no con otra consulta: es la misma
 * pasada, mirada desde el otro lado. Sirve para responder la pregunta que el tablero no contestaba
 * —"¿esto va a aprender algo alguna vez?"— y en particular para separar "falta muestra" (se
 * arregla publicando) de "sin variacion" (no se arregla nunca, porque todos los videos son iguales
 * en ese atributo y no existe el grupo contrario).
 */
export function analyzeCoverage(samples: LearningSample[], discovered: DiscoveredDimension[] = []): DimensionCoverage[] {
  return allDimensions(discovered).map((dimension): DimensionCoverage => {
    const buckets = bucketize(dimension, samples);
    const groups = [...buckets.entries()]
      .map(([label, values]) => ({ label, count: values.length }))
      .sort((a, b) => b.count - a.count);
    const usable = usableBuckets(buckets);

    let status: DimensionStatus;
    if (groups.length === 0) status = "sin_datos";
    else if (groups.length === 1) status = "sin_variacion";
    else if (usable.length < 2) status = "muestra_insuficiente";
    else if (usable[0]!.mean - usable[usable.length - 1]!.mean < MIN_DELTA_POINTS) status = "sin_diferencia";
    else status = "aprendiendo";

    return { dimension: dimension.label, status, groups };
  });
}

/** Compara los grupos de una dimension y emite una leccion si la brecha es real y no anecdotica. */
function analyzeDimension(dimension: Dimension, samples: LearningSample[]): PerformanceLearning | null {
  const usable = usableBuckets(bucketize(dimension, samples));

  // Hacen falta al menos dos grupos comparables: con uno solo no hay contra que medir.
  if (usable.length < 2) return null;

  const best = usable[0]!;
  const worst = usable[usable.length - 1]!;
  const deltaPoints = best.mean - worst.mean;
  if (deltaPoints < MIN_DELTA_POINTS) return null;

  return {
    dimension: dimension.label,
    insight: `${capitalize(best.label)} rinde mejor que ${worst.label}: ${best.mean.toFixed(0)}% vs ${worst.mean.toFixed(0)}% de ${dimension.outcomeLabel}.`,
    recommendation: `Prefiere ${best.label}; evita ${worst.label}.`,
    deltaPoints,
    sampleSize: usable.reduce((total, bucket) => total + bucket.count, 0),
    // Los grupos completos viajan con la leccion para que la UI pueda dibujar la comparacion. El
    // prompt sigue usando solo `insight`/`recommendation`, asi que esto no le cuesta tokens.
    buckets: usable,
    outcomeLabel: dimension.outcomeLabel,
  };
}

/** Promedio ponderado: los videos recientes mueven mas la aguja que los viejos. */
function weightedMean(values: WeightedValue[]): number {
  const totalWeight = values.reduce((total, v) => total + v.weight, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((total, v) => total + v.value * v.weight, 0) / totalWeight;
}

/** Las columnas `numeric` de Postgres llegan como string; un null debe quedar en undefined, no en 0. */
function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
