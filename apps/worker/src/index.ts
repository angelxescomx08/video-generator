import { getBoss, QUEUES } from "@video-generator/queue";
import type { Job } from "pg-boss";
import { handleBuildEdl } from "./handlers/build-edl.handler";
import { handleDiscoverDimensions } from "./handlers/discover-dimensions.handler";
import { handleDiscoverTopics } from "./handlers/discover-topics.handler";
import { handleFetchStockFootage } from "./handlers/fetch-stock-footage.handler";
import { handleGenerateScript } from "./handlers/generate-script.handler";
import { handleGenerateTts } from "./handlers/generate-tts.handler";
import { handleLabelDimensions } from "./handlers/label-dimensions.handler";
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
  // No lleva payload: analiza el canal entero, no un video. Se dispara solo a mano desde
  // /analytics — proponer dimensiones cuesta llamadas al LLM y no gana nada corriendo en automatico
  // sobre una muestra que casi no cambio desde la vez anterior.
  await boss.work(QUEUES.DISCOVER_DIMENSIONS, perJob(handleDiscoverDimensions));
  // Tampoco lleva payload: busca los pares (video, dimension) sin respuesta y los rellena. Es la
  // pieza que hace que las preguntas descubiertas sigan creciendo su muestra con cada video nuevo,
  // en vez de quedarse congeladas en la muestra que tenian el dia que nacieron.
  await boss.work(QUEUES.LABEL_DIMENSIONS, perJob(handleLabelDimensions));
  // Mira hacia AFUERA (que contar) mientras DISCOVER_DIMENSIONS mira hacia adentro (que funciono).
  // Tambien manual: cada corrida gasta una busqueda web, una llamada al LLM y un embedding por idea.
  await boss.work(QUEUES.DISCOVER_TOPICS, perJob(handleDiscoverTopics));

  // Recurring stats poll across all published videos, every 6 hours.
  await boss.schedule(QUEUES.POLL_STATS, "0 */6 * * *", {});
  // Red de seguridad del etiquetado, desfasada una hora del poll para no pelear por el rate limit
  // del proveedor de IA. Normalmente no encuentra nada que hacer y termina en una sola consulta.
  await boss.schedule(QUEUES.LABEL_DIMENSIONS, "0 1/6 * * *", {});

  logger.info("Worker started, listening on all queues");
}

main().catch((err) => {
  logger.error("Worker failed to start", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
