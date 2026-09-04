import { db, dimensionDiscoveryRuns, learningDimensions, videoDimensionLabels, videos } from "@video-generator/db";
import type { DimensionStatus as LearningDimensionStatus } from "@video-generator/db";
import type { PerformanceLearning } from "@video-generator/types";
import { desc, inArray, sql } from "drizzle-orm";
import {
  analyzeDiscoveredDimension,
  groupByDiscovered,
  loadLearningSamples,
  MIN_DELTA_POINTS,
  MIN_SAMPLES_PER_BUCKET,
  type DiscoveredDimension,
  type DiscoveredGroup,
} from "./learnings";

/**
 * Todo lo que hay que saber de las preguntas que la IA se invento, para poder MIRARLAS.
 *
 * El motor mezcla a proposito las dimensiones descubiertas con las escritas a mano (`allDimensions`):
 * para promediar y filtrar da igual de donde salio la pregunta, y esa uniformidad es justo lo que
 * hace seguro dejar que un LLM proponga. Pero para quien apreta el boton no da igual: quiere ver que
 * pregunto, por que la pregunto y como quedaron repartidos sus videos. El tablero solo ensena el
 * `label` — el nombre corto — y ni la hipotesis ni su justificacion aparecen en ningun lado, asi que
 * el resultado del descubrimiento terminaba existiendo solo en la base.
 *
 * Aqui se junta lo que ya calcula el motor (grupos, pesos, veredicto) con lo que solo esta en
 * `learning_dimensions` (pregunta, razonamiento, cuando nacio) y con el historial de corridas.
 */

/** Por que una pregunta todavia no da veredicto. Mismo vocabulario que `analyzeCoverage`. */
export type DiscoveryVerdict =
  | "con_leccion"
  | "sin_diferencia"
  | "muestra_insuficiente"
  | "sin_variacion"
  | "sin_datos";

/** Un grupo con sus videos ya identificados. `Omit` y no interseccion: se REEMPLAZA `videos`. */
export interface DiscoveryGroupDetail extends Omit<DiscoveredGroup, "videos"> {
  videos: { videoId: string; title: string; value: number; weight: number }[];
}

export interface DiscoveredDimensionDetail {
  id: string;
  /** Nombre corto con el que aparece en el tablero. */
  label: string;
  /** La pregunta EXACTA que se le hizo al clasificador sobre cada guion. */
  question: string;
  /** Por que la IA propuso esta pregunta, con sus palabras. Es el patron que dice haber visto. */
  rationale: string;
  /** Las respuestas que propuso, en el orden en que las propuso. */
  proposedBuckets: string[];
  outcomeLabel: string;
  status: LearningDimensionStatus;
  createdAt: string;
  /** Videos con etiqueta guardada, midan o no. Es lo que costo clasificar. */
  labeledVideos: number;
  /** De esos, los que ademas son muestra utilizable. Es sobre lo que se decide. */
  measurableVideos: number;
  verdict: DiscoveryVerdict;
  /** La leccion, si la diferencia entre grupos ya es real. */
  learning: PerformanceLearning | null;
  /** Los grupos con sus videos. Incluye los que aun no llegan al minimo, marcados con `usable`. */
  groups: DiscoveryGroupDetail[];
  /** Respuestas propuestas que ningun video recibio. Un bucket vacio es informacion, no un hueco. */
  unusedBuckets: string[];
}

export interface DiscoveryRunSummary {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  sampleCount: number;
  proposedCount: number;
  errorMessage: string | null;
}

export interface DiscoveryReport {
  dimensions: DiscoveredDimensionDetail[];
  runs: DiscoveryRunSummary[];
  /** Videos medibles detras de todo el reporte. */
  sampleCount: number;
  minSamplesPerBucket: number;
  minDeltaPoints: number;
}

/** Cuantas corridas pasadas se listan. Es un historial para entender, no un log. */
const RUN_HISTORY = 10;

export async function getDiscoveryReport(): Promise<DiscoveryReport> {
  // Las cinco consultas salen juntas: cada `await` suelto es un viaje mas a la base antes de poder
  // pintar, y ninguna depende del resultado de otra.
  const [samples, dimensionRows, labelCounts, runRows] = await Promise.all([
    loadLearningSamples(),
    db
      .select({
        id: learningDimensions.id,
        label: learningDimensions.label,
        question: learningDimensions.question,
        rationale: learningDimensions.rationale,
        buckets: learningDimensions.buckets,
        outcome: learningDimensions.outcome,
        status: learningDimensions.status,
        createdAt: learningDimensions.createdAt,
      })
      .from(learningDimensions)
      .orderBy(desc(learningDimensions.createdAt)),
    // Se cuenta en Postgres y no contando etiquetas en JS: `video_dimension_labels` crece con
    // videos x dimensiones y aqui solo hace falta el numero.
    db
      .select({
        dimensionId: videoDimensionLabels.dimensionId,
        labeled: sql<number>`count(*)::int`,
      })
      .from(videoDimensionLabels)
      .groupBy(videoDimensionLabels.dimensionId),
    db
      .select({
        id: dimensionDiscoveryRuns.id,
        status: dimensionDiscoveryRuns.status,
        startedAt: dimensionDiscoveryRuns.startedAt,
        finishedAt: dimensionDiscoveryRuns.finishedAt,
        sampleCount: dimensionDiscoveryRuns.sampleCount,
        proposedCount: dimensionDiscoveryRuns.proposedCount,
        errorMessage: dimensionDiscoveryRuns.errorMessage,
      })
      .from(dimensionDiscoveryRuns)
      .orderBy(desc(dimensionDiscoveryRuns.startedAt))
      .limit(RUN_HISTORY),
  ]);

  // Los titulos se piden aparte y solo para la muestra que se va a pintar: `loadLearningSamples` no
  // los trae porque su otro consumidor es el prompt del guion, al que no le sirven.
  const titleRows = samples.length
    ? await db
        .select({ id: videos.id, title: videos.title })
        .from(videos)
        .where(inArray(videos.id, samples.map((s) => s.videoId)))
    : [];
  const titleById = new Map(titleRows.map((r) => [r.id, r.title]));
  const labeledById = new Map(labelCounts.map((r) => [r.dimensionId, r.labeled]));

  const dimensions = dimensionRows.map((row): DiscoveredDimensionDetail => {
    const discovered: DiscoveredDimension = {
      id: row.id,
      label: row.label,
      outcome: row.outcome as DiscoveredDimension["outcome"],
    };
    const groups = groupByDiscovered(discovered, samples);
    const learning = analyzeDiscoveredDimension(discovered, samples);
    const usable = groups.filter((g) => g.usable);
    const observed = new Set(groups.map((g) => g.label));

    let verdict: DiscoveryVerdict;
    if (groups.length === 0) verdict = "sin_datos";
    else if (groups.length === 1) verdict = "sin_variacion";
    else if (usable.length < 2) verdict = "muestra_insuficiente";
    else if (!learning) verdict = "sin_diferencia";
    else verdict = "con_leccion";

    return {
      id: row.id,
      label: row.label,
      question: row.question,
      rationale: row.rationale,
      proposedBuckets: row.buckets,
      outcomeLabel: learning?.outcomeLabel ?? "porcentaje del video visto",
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      labeledVideos: labeledById.get(row.id) ?? 0,
      measurableVideos: groups.reduce((total, g) => total + g.count, 0),
      verdict,
      learning,
      groups: groups.map((g) => ({
        ...g,
        videos: g.videos.map((v) => ({ ...v, title: titleById.get(v.videoId) ?? "(sin titulo)" })),
      })),
      unusedBuckets: row.buckets.filter((b) => !observed.has(b)),
    };
  });

  return {
    dimensions,
    runs: runRows.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    sampleCount: samples.length,
    minSamplesPerBucket: MIN_SAMPLES_PER_BUCKET,
    minDeltaPoints: MIN_DELTA_POINTS,
  };
}
