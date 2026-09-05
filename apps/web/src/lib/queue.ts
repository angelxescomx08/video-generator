import { getBoss, QUEUES } from "@video-generator/queue";
import type { JobType } from "@video-generator/db";

export async function enqueueVideoGeneration(videoId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.GENERATE_SCRIPT, { videoId });
}

/**
 * Mapea el stage que fallo a su cola, para reintentar sin repetir stages ya completados (guion, tts,
 * etc). `publish` NO esta aqui a proposito: es el unico job cuyo payload lleva algo mas que el
 * videoId, asi que se reencola con `enqueuePublish`.
 */
const STAGE_QUEUE: Partial<Record<JobType, string>> = {
  script: QUEUES.GENERATE_SCRIPT,
  tts: QUEUES.GENERATE_TTS,
  stock_footage: QUEUES.FETCH_STOCK_FOOTAGE,
  edl: QUEUES.BUILD_EDL,
  render: QUEUES.RENDER_VIDEO,
};

export async function enqueueVideoResume(videoId: string, failedStage: JobType): Promise<void> {
  // Reanudar `publish` por aqui mandaba `{ videoId }` a una cola cuyo schema exige
  // `platformAccountId`: el worker moria en el zod.parse ANTES de runStage, nadie marcaba el video
  // como fallido y se quedaba en 'queued' para siempre. Se corta explicito para que no vuelva a
  // colarse en silencio.
  if (failedStage === "publish") {
    throw new Error("El stage 'publish' se reencola con enqueuePublish(videoId, platformAccountId)");
  }
  const queue = STAGE_QUEUE[failedStage] ?? QUEUES.GENERATE_SCRIPT;
  const boss = await getBoss();
  await boss.send(queue, { videoId });
}

export async function enqueuePublish(videoId: string, platformAccountId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.PUBLISH_VIDEO, { videoId, platformAccountId });
}

/**
 * Poll de estadisticas a demanda. Sin `videoId` barre todos los videos publicados — es la misma
 * forma del payload que usa el cron de cada 6h (ver pollStatsPayloadSchema).
 */
export async function enqueueStatsPoll(videoId?: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.POLL_STATS, videoId ? { videoId } : {});
}

/** Dispara el descubrimiento de dimensiones nuevas. No lleva payload: analiza el canal completo. */
export async function enqueueDimensionDiscovery(): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.DISCOVER_DIMENSIONS, {});
}

/**
 * Dispara la busqueda de temas nuevos para UN tema del canal.
 *
 * Lleva payload (a diferencia del descubrimiento de dimensiones) porque cada tema busca cosas
 * distintas: no existe una consulta que sirva para "biblia" y para "curiosidades de historia" a la
 * vez, y mezclar las propuestas de dos temas en la misma bandeja las haria inaprobables.
 */
export async function enqueueTopicDiscovery(themeId: string, query?: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.DISCOVER_TOPICS, { themeId, query });
}
