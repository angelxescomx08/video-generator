import { resolveProvider } from "@video-generator/ai-providers";
import type { ProposedDimension } from "@video-generator/ai-providers";
import {
  loadDiscoveredDimensions,
  loadLearningSamples,
  type LearningSample,
} from "@video-generator/analytics";
import { db, learningDimensions, videoDimensionLabels, videos } from "@video-generator/db";
import { inArray } from "drizzle-orm";
import { logger } from "../util/logger";

/**
 * Descubrimiento de dimensiones: la IA lee los guiones que mejor y peor rindieron y propone
 * PREGUNTAS nuevas para medir, que se guardan en `learning_dimensions` y pasan a analizarse como una
 * dimension mas.
 *
 * Es la salida del techo del motor de aprendizaje. La lista de dimensiones escrita a mano puede
 * responder muy bien sus preguntas y ninguna otra: cuando todas tienen veredicto, el sistema deja de
 * aprender cosas nuevas para siempre. Aqui las preguntas dejan de venir solo de un humano.
 *
 * El reparto de responsabilidad es lo que hace esto seguro: **la IA propone, el dato dispone.** Un
 * LLM con diez guiones enfrente "encuentra" patrones que son ruido; por eso lo unico que se le pide
 * es la hipotesis, y quien decide si significa algo es la misma agregacion que ya filtra por muestra
 * efectiva y diferencia minima. Una pregunta absurda no rompe nada: nunca produce una leccion.
 */

/** Cuantos guiones de cada extremo se le muestran a la IA. */
const SAMPLES_PER_EXTREME = 5;
/** Cuantas preguntas puede proponer por corrida. */
const MAX_PROPOSALS = 3;
/**
 * Tope de dimensiones descubiertas activas.
 *
 * Cada una cuesta una llamada de clasificacion por video, para siempre — sin tope, apretar el boton
 * varias veces convierte cada video nuevo en decenas de llamadas. Ademas, mas preguntas sobre la
 * misma muestra chica es la receta para encontrar correlaciones falsas: cuantas mas preguntas le
 * haces a diez videos, mas probable es que alguna de un resultado bonito por pura casualidad.
 */
const MAX_ACTIVE_DISCOVERED = 8;

/** Guiones minimos medibles para que buscar patrones tenga algun sentido. */
const MIN_SAMPLES_TO_PROPOSE = 6;

/** Clasificaciones en vuelo a la vez. Ver el bucle en `classifyPublishedVideos`. */
const CLASSIFY_CONCURRENCY = 5;

/**
 * Recorte del guion que se le manda a la IA.
 *
 * Se acota porque son 10 guiones en un solo prompt y un video largo puede traer 1500 palabras cada
 * uno: sin tope, la propuesta se vuelve la llamada mas cara del sistema. Con el arranque y el cierre
 * alcanza para juzgar estructura, gancho y remate, que es de lo que salen las hipotesis utiles.
 */
const SCRIPT_CHAR_BUDGET = 1200;

function trimScript(script: string): string {
  if (script.length <= SCRIPT_CHAR_BUDGET) return script;
  const head = Math.floor(SCRIPT_CHAR_BUDGET * 0.7);
  const tail = SCRIPT_CHAR_BUDGET - head;
  return `${script.slice(0, head)}\n[...]\n${script.slice(-tail)}`;
}

/**
 * Una propuesta solo entra si esta bien formada. No es paranoia: el resto del motor asume que
 * `buckets` tiene opciones excluyentes y que el clasificador puede contestar una de ellas, y una
 * propuesta con un solo bucket produciria una dimension que jamas puede comparar nada.
 */
function isUsable(proposal: ProposedDimension): boolean {
  const buckets = (proposal.buckets ?? []).map((b) => b.trim()).filter(Boolean);
  const unique = new Set(buckets);
  return (
    Boolean(proposal.label?.trim()) &&
    Boolean(proposal.question?.trim()) &&
    unique.size >= 2 &&
    unique.size <= 4 &&
    unique.size === buckets.length
  );
}

export async function handleDiscoverDimensions(): Promise<void> {
  const [samples, active] = await Promise.all([loadLearningSamples(), loadDiscoveredDimensions()]);

  if (samples.length < MIN_SAMPLES_TO_PROPOSE) {
    logger.warn(
      `Descubrimiento cancelado: hacen falta ${MIN_SAMPLES_TO_PROPOSE} videos medibles y hay ${samples.length}`,
    );
    return;
  }

  const slots = MAX_ACTIVE_DISCOVERED - active.length;
  if (slots <= 0) {
    logger.warn(`Descubrimiento cancelado: ya hay ${active.length} dimensiones descubiertas activas`);
    return;
  }

  // Se ordena por el porcentaje del video visto porque es la metrica que califica el guion COMPLETO,
  // que es lo que la IA va a leer. Ordenar por retencion inicial la haria buscar en todo el guion la
  // explicacion de algo que se decide en los primeros tres segundos.
  const scored = samples
    .filter((s) => s.outcomes.avgViewPercentage !== undefined)
    .sort((a, b) => b.outcomes.avgViewPercentage! - a.outcomes.avgViewPercentage!);

  const best = scored.slice(0, SAMPLES_PER_EXTREME);
  const worst = scored.slice(-SAMPLES_PER_EXTREME);
  const scriptRows = await db
    .select({ id: videos.id, script: videos.script })
    .from(videos)
    .where(inArray(videos.id, [...best, ...worst].map((s) => s.videoId)));
  const scriptById = new Map(scriptRows.map((r) => [r.id, r.script ?? ""]));

  const toSample = (s: LearningSample) => ({
    script: trimScript(scriptById.get(s.videoId) ?? ""),
    outcomeValue: s.outcomes.avgViewPercentage!,
  });

  const provider = await resolveProvider();
  const { result: proposals } = await provider.proposeDimensions({
    best: best.map(toSample),
    worst: worst.map(toSample),
    outcomeLabel: "porcentaje del video visto",
    alreadyMeasured: MEASURED_DESCRIPTIONS,
    maxProposals: Math.min(MAX_PROPOSALS, slots),
  });

  const usable = proposals.filter(isUsable).slice(0, slots);
  if (usable.length === 0) {
    logger.warn("La IA no devolvio ninguna propuesta bien formada", { recibidas: proposals.length });
    return;
  }

  const inserted = await db
    .insert(learningDimensions)
    .values(
      usable.map((p) => ({
        label: p.label.trim(),
        question: p.question.trim(),
        buckets: p.buckets.map((b) => b.trim()),
        outcome: "avgViewPercentage" as const,
        rationale: p.rationale?.trim() || "(sin justificacion)",
      })),
    )
    .returning({ id: learningDimensions.id, label: learningDimensions.label });

  logger.info(`Dimensiones descubiertas: ${inserted.map((d) => d.label).join(", ")}`);

  for (const dimension of inserted) {
    const proposal = usable.find((p) => p.label.trim() === dimension.label)!;
    await classifyPublishedVideos(dimension.id, proposal);
  }
}

/**
 * Etiqueta TODOS los videos ya publicados con la pregunta nueva.
 *
 * Sin esto la dimension nace sin datos y tardaria un canal entero en decir algo. Se hace una vez por
 * dimension y se guarda: el `unique(video, dimension)` de la tabla hace que reintentar el job no
 * duplique etiquetas ni vuelva a pagar. Un fallo de clasificacion solo deja ese video sin etiqueta,
 * que el motor ya sabe tratar como "fuera de esta dimension".
 */
async function classifyPublishedVideos(dimensionId: string, proposal: ProposedDimension): Promise<void> {
  const provider = await resolveProvider();
  const rows = await db
    .select({ id: videos.id, script: videos.script })
    .from(videos)
    .where(inArray(videos.status, ["published", "ready"]));

  const pending = rows.filter((row) => row.script);
  let labeled = 0;

  // En tandas y no de una en una: son cientos de llamadas independientes entre si (una por video por
  // dimension) y hacerlas en fila convertia el boton en varios minutos de espera. El tamano de tanda
  // es chico a proposito — el limite real aqui es el rate limit del proveedor, no la CPU.
  for (let i = 0; i < pending.length; i += CLASSIFY_CONCURRENCY) {
    const batch = pending.slice(i, i + CLASSIFY_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (row) => {
        try {
          const { result: bucket } = await provider.classifyDimension({
            script: trimScript(row.script!),
            question: proposal.question,
            buckets: proposal.buckets,
          });
          // Un bucket inventado no se guarda: dejaria un grupo de un solo video que ensucia la
          // comparacion sin aportar nada.
          return proposal.buckets.includes(bucket) ? { videoId: row.id, bucket } : null;
        } catch (err) {
          logger.warn(`No se pudo clasificar el video ${row.id}`, { error: (err as Error).message });
          return null;
        }
      }),
    );

    const toInsert = results.filter((r): r is { videoId: string; bucket: string } => r !== null);
    if (toInsert.length > 0) {
      await db
        .insert(videoDimensionLabels)
        .values(toInsert.map((r) => ({ videoId: r.videoId, dimensionId, bucket: r.bucket })))
        .onConflictDoNothing();
      labeled += toInsert.length;
    }
  }

  logger.info(`Dimension ${dimensionId}: ${labeled}/${pending.length} videos etiquetados`);
}

/** Lo que el motor ya mide, en lenguaje natural, para que la IA no proponga algo que ya existe. */
const MEASURED_DESCRIPTIONS = [
  "si el gancho abre con pregunta o con afirmacion",
  "cuantas palabras tiene el gancho",
  "si el gancho incluye un numero o dato concreto",
  "cuantas escenas tiene el video y cuanto dura cada una",
  "la duracion total del video",
  "el ritmo de narracion en palabras por segundo",
  "si lleva musica de fondo y de que mood",
  "si lleva subtitulos quemados",
  "que efectos visuales usa y si el gancho tiene golpe visual",
];
