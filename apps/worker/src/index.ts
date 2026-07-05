import { getBoss, QUEUES } from "@video-generator/queue";
import type { Job } from "pg-boss";
import { handleBuildEdl } from "./handlers/build-edl.handler";
import { handleFetchStockFootage } from "./handlers/fetch-stock-footage.handler";
import { handleGenerateScript } from "./handlers/generate-script.handler";
import { handleGenerateTts } from "./handlers/generate-tts.handler";
import { handlePollStats } from "./handlers/poll-stats.handler";
import { handlePublishVideo } from "./handlers/publish-video.handler";
import { handleRenderVideo } from "./handlers/render-video.handler";
import { logger } from "./util/logger";

/** pg-boss delivers jobs in batches (default size 1) — process each job's payload in turn. */
function perJob<T>(handler: (data: T) => Promise<void>) {
  return async (jobs: Job<T>[]) => {
    for (const job of jobs) {
      await handler(job.data);
    }
  };
}

async function main() {
  const boss = await getBoss();

  await boss.work(QUEUES.GENERATE_SCRIPT, perJob(handleGenerateScript));
  await boss.work(QUEUES.GENERATE_TTS, perJob(handleGenerateTts));
  await boss.work(QUEUES.FETCH_STOCK_FOOTAGE, perJob(handleFetchStockFootage));
  await boss.work(QUEUES.BUILD_EDL, perJob(handleBuildEdl));
  await boss.work(QUEUES.RENDER_VIDEO, perJob(handleRenderVideo));
  await boss.work(QUEUES.PUBLISH_VIDEO, perJob(handlePublishVideo));
  await boss.work(QUEUES.POLL_STATS, perJob(handlePollStats));

  // Recurring stats poll across all published videos, every 6 hours.
  await boss.schedule(QUEUES.POLL_STATS, "0 */6 * * *", {});

  logger.info("Worker started, listening on all queues");
}

main().catch((err) => {
  logger.error("Worker failed to start", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
