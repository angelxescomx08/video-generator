import { getBoss, QUEUES } from "@video-generator/queue";

export async function enqueueVideoGeneration(videoId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.GENERATE_SCRIPT, { videoId });
}

export async function enqueuePublish(videoId: string, platformAccountId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.PUBLISH_VIDEO, { videoId, platformAccountId });
}
