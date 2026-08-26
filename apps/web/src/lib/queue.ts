import { getBoss, QUEUES } from "@video-generator/queue";
import type { JobType } from "@video-generator/db";

export async function enqueueVideoGeneration(videoId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.GENERATE_SCRIPT, { videoId });
}

/** Mapea el stage que fallo a su cola, para reintentar sin repetir stages ya completados (guion, tts, etc). */
const STAGE_QUEUE: Partial<Record<JobType, string>> = {
  script: QUEUES.GENERATE_SCRIPT,
  tts: QUEUES.GENERATE_TTS,
  stock_footage: QUEUES.FETCH_STOCK_FOOTAGE,
  edl: QUEUES.BUILD_EDL,
  render: QUEUES.RENDER_VIDEO,
  publish: QUEUES.PUBLISH_VIDEO,
};

export async function enqueueVideoResume(videoId: string, failedStage: JobType): Promise<void> {
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
