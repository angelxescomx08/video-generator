import { db, publishedVideos, videoStats, videos } from "@video-generator/db";
import type { PerformanceLearning } from "@video-generator/ai-providers";
import { MIN_DAYS_FOR_LEARNING, MIN_VIEWS_FOR_LEARNING } from "@video-generator/types";
import { eq } from "drizzle-orm";
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
 */

/** Videos minimos por grupo para comparar. Con menos, la diferencia es anecdota, no patron. */
const MIN_SAMPLES_PER_BUCKET = 3;

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

interface Sample {
  attrs: VideoAttributes;
  outcomes: Outcomes;
}

/**
 * Una dimension a analizar: como agrupar los videos y con que metrica calificar ese grupo. La
 * metrica no es intercambiable — el tipo de gancho se juzga por la retencion inicial, mientras que el
 * numero de escenas se juzga por el porcentaje total visto. Cruzarlas daria conclusiones falsas.
 */
interface Dimension {
  label: string;
  outcome: keyof Outcomes;
  outcomeLabel: string;
  /** Devuelve el nombre del grupo, o null para excluir el video de esta dimension. */
  bucket: (attrs: VideoAttributes) => string | null;
}

const DIMENSIONS: readonly Dimension[] = [
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
  const samples = await loadSamples();
  const learnings: PerformanceLearning[] = [];

  for (const dimension of DIMENSIONS) {
    const learning = analyzeDimension(dimension, samples);
    if (learning) learnings.push(learning);
  }

  return learnings.sort((a, b) => b.deltaPoints - a.deltaPoints).slice(0, MAX_LEARNINGS);
}

/**
 * Un snapshot por video publicado (el mas reciente), ya filtrado a los que son senal utilizable.
 * Los descartes son deliberados: un video de dos dias todavia se esta distribuyendo y uno con 30
 * vistas da porcentajes que se mueven entero con un solo espectador.
 */
async function loadSamples(): Promise<Sample[]> {
  const rows = await db
    .select({
      publishedVideoId: videoStats.publishedVideoId,
      capturedAt: videoStats.capturedAt,
      videoAgeDays: videoStats.videoAgeDays,
      views: videoStats.views,
      engagedViews: videoStats.engagedViews,
      avgViewPercentage: videoStats.avgViewPercentage,
      retentionAtStartPercentage: videoStats.retentionAtStartPercentage,
      video: videos,
    })
    .from(videoStats)
    .innerJoin(publishedVideos, eq(videoStats.publishedVideoId, publishedVideos.id))
    .innerJoin(videos, eq(publishedVideos.videoId, videos.id))
    .where(eq(publishedVideos.status, "published"));

  // Solo el snapshot mas reciente de cada video: los anteriores son el mismo video medido antes, y
  // contarlos varias veces le daria a un video con mucho historial mas peso que a los demas.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = latest.get(row.publishedVideoId);
    if (!current || row.capturedAt > current.capturedAt) latest.set(row.publishedVideoId, row);
  }

  const samples: Sample[] = [];
  for (const row of latest.values()) {
    const sampleSize = row.engagedViews ?? row.views ?? 0;
    if (sampleSize < MIN_VIEWS_FOR_LEARNING) continue;
    if (row.videoAgeDays !== null && row.videoAgeDays < MIN_DAYS_FOR_LEARNING) continue;

    const outcomes: Outcomes = {
      retentionAtStart: toNumber(row.retentionAtStartPercentage),
      avgViewPercentage: toNumber(row.avgViewPercentage),
    };
    if (outcomes.retentionAtStart === undefined && outcomes.avgViewPercentage === undefined) continue;

    samples.push({ attrs: extractVideoAttributes(row.video), outcomes });
  }
  return samples;
}

/** Compara los grupos de una dimension y emite una leccion si la brecha es real y no anecdotica. */
function analyzeDimension(dimension: Dimension, samples: Sample[]): PerformanceLearning | null {
  const buckets = new Map<string, number[]>();

  for (const sample of samples) {
    const outcome = sample.outcomes[dimension.outcome];
    if (outcome === undefined) continue;
    const key = dimension.bucket(sample.attrs);
    if (key === null) continue;
    const list = buckets.get(key) ?? [];
    list.push(outcome);
    buckets.set(key, list);
  }

  const usable = [...buckets.entries()]
    .filter(([, values]) => values.length >= MIN_SAMPLES_PER_BUCKET)
    .map(([key, values]) => ({ key, mean: mean(values), count: values.length }))
    .sort((a, b) => b.mean - a.mean);

  // Hacen falta al menos dos grupos comparables: con uno solo no hay contra que medir.
  if (usable.length < 2) return null;

  const best = usable[0]!;
  const worst = usable[usable.length - 1]!;
  const deltaPoints = best.mean - worst.mean;
  if (deltaPoints < MIN_DELTA_POINTS) return null;

  return {
    dimension: dimension.label,
    insight: `${capitalize(best.key)} rinde mejor que ${worst.key}: ${best.mean.toFixed(0)}% vs ${worst.mean.toFixed(0)}% de ${dimension.outcomeLabel}.`,
    recommendation: `Prefiere ${best.key}; evita ${worst.key}.`,
    deltaPoints,
    sampleSize: usable.reduce((total, bucket) => total + bucket.count, 0),
  };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
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
