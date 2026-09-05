import { resolveProvider } from "@video-generator/ai-providers";
import type { ProposedDimension } from "@video-generator/ai-providers";
import {
  getDiscoveryEligibility,
  loadDiscoveredDimensions,
  loadLearningSamples,
  MAX_ACTIVE_DISCOVERED,
  SAMPLES_PER_EXTREME,
  type LearningSample,
} from "@video-generator/analytics";
import {
  db,
  dimensionDiscoveryRuns,
  learningDimensions,
  videos,
} from "@video-generator/db";
import { eq, inArray } from "drizzle-orm";
import { labelMissingDimensions, trimScript } from "../learning/label-dimensions";
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

/** Cuantas preguntas puede proponer por corrida. */
const MAX_PROPOSALS = 3;

/**
 * Ventana de videos recientes de la que salen los extremos que lee la IA.
 *
 * Sin ventana, "los 5 mejores y los 5 peores" se calculaban sobre TODO el historial, asi que a
 * medida que el canal crece los extremos se congelan: los mismos videos viejos ganan y pierden para
 * siempre, y lo que se publica hoy nunca llega al prompt. El sistema acabaria explicando una y otra
 * vez por que unos videos de hace meses rindieron distinto entre si.
 *
 * El numero es el doble del techo de vida media que usa la ponderacion por recencia
 * (`HALF_LIFE_MAX_VIDEOS`, 15): la misma idea de "ventana movil" que ya gobierna las lecciones, con
 * margen para que los dos extremos no se toquen. Si el canal tiene menos videos que esto, la ventana
 * es todo el canal y no cambia nada.
 */
const RECENT_WINDOW = 30;

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
  // Se vuelve a evaluar aqui aunque la ruta ya lo haya hecho: entre que se encolo el job y que se
  // ejecuta pudo entrar otra corrida, y es esta la que gasta las llamadas al LLM.
  const eligibility = await getDiscoveryEligibility();
  if (!eligibility.enabled) {
    logger.warn(`Descubrimiento cancelado: ${eligibility.reason}`);
    return;
  }

  const [samples, active] = await Promise.all([loadLearningSamples(), loadDiscoveredDimensions()]);
  const slots = MAX_ACTIVE_DISCOVERED - active.length;

  const [run] = await db
    .insert(dimensionDiscoveryRuns)
    .values({ sampleCount: samples.length })
    .returning({ id: dimensionDiscoveryRuns.id });

  try {
    const proposed = await runDiscovery(samples, slots);
    await db
      .update(dimensionDiscoveryRuns)
      .set({ status: "completed", finishedAt: new Date(), proposedCount: proposed })
      .where(eq(dimensionDiscoveryRuns.id, run!.id));
  } catch (err) {
    // La corrida se cierra como fallida pase lo que pase: si quedara en "running", el boton se
    // bloquearia para siempre esperando algo que ya murio.
    await db
      .update(dimensionDiscoveryRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: (err as Error).message })
      .where(eq(dimensionDiscoveryRuns.id, run!.id));
    throw err;
  }
}

async function runDiscovery(samples: LearningSample[], slots: number): Promise<number> {

  // `samples` viene del mas reciente al mas viejo (ver loadLearningSamples), asi que cortar por la
  // cabeza es quedarse con la ventana reciente. Se recorta ANTES de ordenar por rendimiento: lo que
  // se le pide explicar es por que unos videos NUEVOS rinden distinto que otros videos nuevos.
  const recent = samples.slice(0, RECENT_WINDOW);

  // Se ordena por el porcentaje del video visto (califica el guion COMPLETO, que es lo que la IA lee).
  const scored = recent
    .filter((s) => s.outcomes.avgViewPercentage !== undefined)
    .sort((a, b) => b.outcomes.avgViewPercentage! - a.outcomes.avgViewPercentage!);

  // El tamano de cada extremo nunca puede pasar de la mitad: si los dos grupos comparten videos, se
  // le estaria pidiendo a la IA que explique la diferencia entre un conjunto y si mismo. El gate ya
  // exige 2x, pero esto lo garantiza aunque alguien afloje ese minimo despues.
  const perExtreme = Math.min(SAMPLES_PER_EXTREME, Math.floor(scored.length / 2));
  const best = scored.slice(0, perExtreme);
  const worst = scored.slice(-perExtreme);
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
    return 0;
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

  // Etiqueta el canal contra las preguntas recien creadas. Es el mismo backfill que corre al
  // publicar y en el cron: mira los pares (video, dimension activa) sin respuesta, asi que de paso
  // rellena cualquier etiqueta que faltara de una dimension anterior.
  await labelMissingDimensions();

  return inserted.length;
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
