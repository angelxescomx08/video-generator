import type { ScriptScene } from "@video-generator/ai-providers";
import { db, videos } from "@video-generator/db";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { resolveStockProviders } from "@video-generator/stock-providers";
import type { StockClipRef } from "@video-generator/types";
import { eq } from "drizzle-orm";
import path from "node:path";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
import { getJobWorkspace } from "../util/tmp-workspace";
import { logger } from "../util/logger";

interface SceneClip {
  sceneIndex: number;
  clip: StockClipRef;
  localPath: string;
}

export async function handleFetchStockFootage(payload: VideoJobPayload): Promise<void> {
  const { videoId } = videoJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  const scenes = (video.scenes as ScriptScene[] | null) ?? [];
  if (scenes.length === 0) throw new Error(`Video ${videoId} has no scenes`);

  const orientation = video.format === "short" ? "portrait" : "landscape";

  await runStage(videoId, STAGES.stock!, async () => {
    const providers = await resolveStockProviders();
    if (providers.length === 0) throw new Error("No stock footage providers are configured/enabled");

    const workspace = await getJobWorkspace(videoId);
    const sceneClips: SceneClip[] = [];

    for (const scene of scenes) {
      let bestClip: { clip: StockClipRef; provider: (typeof providers)[number] } | null = null;

      for (const provider of providers) {
        try {
          const results = await provider.search({
            keywords: scene.visualKeywords,
            mediaType: "video",
            orientation,
            perPage: 5,
          });
          if (results[0]) {
            bestClip = { clip: results[0], provider };
            break;
          }
        } catch (err) {
          logger.warn(`Stock search failed on ${provider.name} for scene ${scene.index}`, {
            error: (err as Error).message,
          });
        }
      }

      if (!bestClip) {
        throw new Error(`No stock footage found for scene ${scene.index} (keywords: ${scene.visualKeywords.join(", ")})`);
      }

      const ext = bestClip.clip.mediaType === "video" ? "mp4" : "jpg";
      const localPath = path.join(workspace, `scene-${scene.index}-clip.${ext}`);
      await bestClip.provider.download(bestClip.clip, localPath);

      sceneClips.push({ sceneIndex: scene.index, clip: bestClip.clip, localPath });
    }

    await db.update(videos).set({ sceneClips, updatedAt: new Date() }).where(eq(videos.id, videoId));

    logger.info(`Stock footage fetched for video ${videoId}`, { scenes: sceneClips.length });
    return sceneClips;
  });

  await setVideoStatus(videoId, "building_edl");
  const boss = await getBoss();
  await boss.send(QUEUES.BUILD_EDL, { videoId });
}
