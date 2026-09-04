import { db, dimensionDiscoveryRuns, learningDimensions, type DiscoveryRunStatus } from "@video-generator/db";
import { desc, eq } from "drizzle-orm";
import { analyzeCoverage, loadDiscoveredDimensions, loadLearningSamples } from "./learnings";

/**
 * Cuando vale la pena buscar dimensiones nuevas, y cuando no.
 *
 * Existe porque el descubrimiento tiene un costo que no se ve: cada dimension nueva es una HIPOTESIS
 * MAS puesta a prueba contra la misma muestra chica. La estadistica de comparaciones multiples dice
 * que con suficientes preguntas sobre pocos datos aparecen "hallazgos" que son ruido puro — con una
 * decena de variables ya salen resultados vistosos de datos completamente aleatorios. Un boton que se
 * puede apretar en cualquier momento invita justo a eso: apretarlo hasta que salga algo bonito.
 *
 * Las condiciones no son burocracia, cada una tapa una forma concreta de engañarse:
 * - Muestra insuficiente o extremos solapados: el "mejor" y el "peor" serian casi los mismos videos.
 * - Preguntas anteriores sin responder: agregar mas hipotesis antes de resolver las abiertas es
 *   exactamente el patron que produce falsos positivos.
 * - Sin videos nuevos: volver a preguntarle a los mismos datos es fishing, no aprendizaje.
 */

/**
 * Videos medibles minimos. El numero sale de la mecanica del propio analisis: se le muestran a la IA
 * los N mejores y los N peores, asi que con menos de 2N los dos grupos comparten videos y el
 * contraste que se le pide encontrar es ficticio.
 */
export const SAMPLES_PER_EXTREME = 5;
export const MIN_SAMPLES_TO_DISCOVER = SAMPLES_PER_EXTREME * 2;

/** Tope de dimensiones descubiertas activas a la vez. Ver el comentario de comparaciones multiples. */
export const MAX_ACTIVE_DISCOVERED = 8;

/**
 * Videos medibles nuevos que tienen que aparecer antes de volver a correrlo.
 *
 * Es el mismo minimo que necesita un grupo para ser comparable: con menos de 3 videos nuevos, la
 * muestra que veria la IA es practicamente la de la vez pasada y la respuesta tambien.
 */
export const MIN_NEW_SAMPLES_BETWEEN_RUNS = 3;

export interface DiscoveryEligibility {
  enabled: boolean;
  /** Por que NO se puede, en una frase lista para mostrar. `null` cuando si se puede. */
  reason: string | null;
  /** Que tendria que pasar para desbloquearlo. `null` cuando ya esta desbloqueado. */
  unlockHint: string | null;
  usableSamples: number;
}

export async function getDiscoveryEligibility(): Promise<DiscoveryEligibility> {
  const [samples, discovered, lastRun, runningRun] = await Promise.all([
    loadLearningSamples(),
    loadDiscoveredDimensions(),
    db
      .select({ sampleCount: dimensionDiscoveryRuns.sampleCount })
      .from(dimensionDiscoveryRuns)
      .where(eq(dimensionDiscoveryRuns.status, "completed"))
      .orderBy(desc(dimensionDiscoveryRuns.startedAt))
      .limit(1),
    db
      .select({ id: dimensionDiscoveryRuns.id })
      .from(dimensionDiscoveryRuns)
      .where(eq(dimensionDiscoveryRuns.status, "running"))
      .limit(1),
  ]);

  const usableSamples = samples.length;
  const blocked = (reason: string, unlockHint: string): DiscoveryEligibility => ({
    enabled: false,
    reason,
    unlockHint,
    usableSamples,
  });

  if (runningRun.length > 0) {
    return blocked(
      "Ya hay un analisis en curso.",
      "Espera a que termine de clasificar el canal; puede tardar un par de minutos.",
    );
  }

  if (usableSamples < MIN_SAMPLES_TO_DISCOVER) {
    return blocked(
      `Hacen falta ${MIN_SAMPLES_TO_DISCOVER} videos con estadisticas utilizables y hay ${usableSamples}.`,
      `Con menos, los ${SAMPLES_PER_EXTREME} mejores y los ${SAMPLES_PER_EXTREME} peores serian casi los mismos videos y el contraste seria falso. Publica ${MIN_SAMPLES_TO_DISCOVER - usableSamples} video(s) mas y espera a que junten vistas.`,
    );
  }

  if (discovered.length >= MAX_ACTIVE_DISCOVERED) {
    return blocked(
      `Ya hay ${discovered.length} preguntas descubiertas activas, que es el tope.`,
      "Retira alguna que no este aportando antes de agregar mas: cada pregunta extra sobre la misma muestra sube la probabilidad de encontrar un patron que en realidad es casualidad.",
    );
  }

  // La condicion mas importante: no acumular preguntas sin responder. Cada dimension abierta es una
  // hipotesis en el aire, y agregar mas antes de cerrarlas es lo que fabrica falsos hallazgos.
  const coverage = analyzeCoverage(samples, discovered);
  const discoveredLabels = new Set(discovered.map((d) => d.label));
  const unanswered = coverage.filter(
    (c) => discoveredLabels.has(c.dimension) && (c.status === "sin_datos" || c.status === "muestra_insuficiente"),
  );

  if (unanswered.length > 0) {
    return blocked(
      `Las preguntas anteriores todavia no tienen respuesta (${unanswered.map((u) => u.dimension).join(", ")}).`,
      "Se desbloquea cuando esas preguntas junten muestra suficiente para dar un veredicto. Agregar mas ahora solo reparte la misma muestra entre mas preguntas, y con pocos datos eso hace que aparezcan patrones que son casualidad.",
    );
  }

  const lastSampleCount = lastRun[0]?.sampleCount;
  if (lastSampleCount !== undefined) {
    const newSamples = usableSamples - lastSampleCount;
    if (newSamples < MIN_NEW_SAMPLES_BETWEEN_RUNS) {
      return blocked(
        `Solo hay ${Math.max(0, newSamples)} video(s) medible(s) nuevo(s) desde el ultimo analisis.`,
        `Se desbloquea con ${MIN_NEW_SAMPLES_BETWEEN_RUNS} videos nuevos. Volver a preguntarle a los mismos datos no da informacion nueva: da otra respuesta de la misma casualidad.`,
      );
    }
  }

  return { enabled: true, reason: null, unlockHint: null, usableSamples };
}

/**
 * Estado de la ultima corrida de descubrimiento, para poder MOSTRAR que esta pasando.
 *
 * Es una consulta aparte y deliberadamente barata: `getDiscoveryEligibility` recalcula la muestra y
 * la cobertura entera (es lo que decide si vale la pena gastar llamadas al LLM), y la UI necesita
 * preguntar "¿sigue corriendo?" cada pocos segundos mientras dura el job. Sondear con la otra
 * pondria el analisis completo del canal detras de un setInterval.
 */
export interface DiscoveryRunState {
  id: string;
  status: DiscoveryRunStatus;
  startedAt: string;
  finishedAt: string | null;
  proposedCount: number;
  errorMessage: string | null;
}

export async function getLatestDiscoveryRun(): Promise<DiscoveryRunState | null> {
  const [row] = await db
    .select({
      id: dimensionDiscoveryRuns.id,
      status: dimensionDiscoveryRuns.status,
      startedAt: dimensionDiscoveryRuns.startedAt,
      finishedAt: dimensionDiscoveryRuns.finishedAt,
      proposedCount: dimensionDiscoveryRuns.proposedCount,
      errorMessage: dimensionDiscoveryRuns.errorMessage,
    })
    .from(dimensionDiscoveryRuns)
    .orderBy(desc(dimensionDiscoveryRuns.startedAt))
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
