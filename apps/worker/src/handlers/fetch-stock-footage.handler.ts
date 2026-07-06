import type { ScriptScene } from "@video-generator/ai-providers";
import { db, videos } from "@video-generator/db";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { resolveStockProviders, type StockFootageProvider } from "@video-generator/stock-providers";
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

/** Terminos genericos en ingles, casi siempre disponibles en los bancos de stock, usados solo si
 * ni las keywords originales ni cada una por separado devolvieron resultados. */
const GENERIC_FALLBACK_KEYWORDS = ["nature background", "abstract texture", "city aerial", "clouds sky"];

/** Prueba las keywords originales, luego cada una por separado (mas laxo que el join completo),
 * y por ultimo terminos genericos — para no tumbar el video entero por una escena sin match. */
async function findSceneClip(
  providers: StockFootageProvider[],
  scene: ScriptScene,
  orientation: "landscape" | "portrait",
): Promise<{ clip: StockClipRef; provider: StockFootageProvider } | null> {
  const queryVariants: string[][] = [
    scene.visualKeywords,
    ...scene.visualKeywords.map((kw) => [kw]),
    ...GENERIC_FALLBACK_KEYWORDS.map((kw) => [kw]),
  ];

  for (let i = 0; i < queryVariants.length; i++) {
    const keywords = queryVariants[i]!;
    for (const provider of providers) {
      try {
        const results = await provider.search({ keywords, mediaType: "video", orientation, perPage: 5 });
        if (results[0]) {
          if (i > 0) {
            logger.warn(
              `Scene ${scene.index}: sin resultados para "${scene.visualKeywords.join(", ")}", usando fallback "${keywords.join(" ")}" en ${provider.name}`,
            );
          }
          return { clip: results[0], provider };
        }
      } catch (err) {
        logger.warn(`Stock search failed on ${provider.name} for scene ${scene.index}`, {
          error: (err as Error).message,
        });
      }
    }
  }
  return null;
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
      const bestClip = await findSceneClip(providers, scene, orientation);

      if (!bestClip) {
        throw new Error(
          `No stock footage found for scene ${scene.index} (keywords: ${scene.visualKeywords.join(", ")}), ni siquiera con los fallbacks genericos`,
        );
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
