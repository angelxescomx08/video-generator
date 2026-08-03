import type { ScriptScene } from "@video-generator/ai-providers";
import { db, themes, videos } from "@video-generator/db";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { resolveProvider } from "@video-generator/tts-providers";
import type { CostItem, ProviderCost } from "@video-generator/types";
import { eq } from "drizzle-orm";
import path from "node:path";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
import { getJobWorkspace } from "../util/tmp-workspace";
import { logger } from "../util/logger";

interface SceneAudio {
  sceneIndex: number;
  audioFilePath: string;
  durationSeconds: number;
}

export async function handleGenerateTts(payload: VideoJobPayload): Promise<void> {
  const { videoId } = videoJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  const theme = await db.query.themes.findFirst({ where: eq(themes.id, video.themeId) });
  const scenes = (video.scenes as ScriptScene[] | null) ?? [];
  if (scenes.length === 0) throw new Error(`Video ${videoId} has no scenes to synthesize`);

  await runStage(videoId, STAGES.tts!, async () => {
    const provider = await resolveProvider();
    const workspace = await getJobWorkspace(videoId);

    const sceneAudio: SceneAudio[] = [];
    const sceneCosts: ProviderCost[] = [];
    for (const scene of scenes) {
      const destPath = path.join(workspace, `scene-${scene.index}.wav`);
      const result = await provider.synthesize({
        text: scene.narrationText,
        voiceId: theme?.defaultVoiceId ?? undefined,
        destPath,
      });
      sceneAudio.push({
        sceneIndex: scene.index,
        audioFilePath: result.audioFilePath,
        durationSeconds: result.durationSeconds,
      });
      sceneCosts.push(result.cost);
    }

    await db
      .update(videos)
      .set({ sceneAudio, updatedAt: new Date() })
      .where(eq(videos.id, videoId));

    const ttsCost: CostItem = {
      stage: "tts",
      providerType: "tts",
      providerName: sceneCosts[0]?.providerName ?? provider.name,
      isFree: sceneCosts.every((c) => c.isFree),
      isLocal: sceneCosts.every((c) => c.isLocal),
      amountUsd: sceneCosts.reduce((sum, c) => sum + c.amountUsd, 0),
      detail: `${scenes.length} escenas`,
    };

    logger.info(`TTS generated for video ${videoId}`, { scenes: sceneAudio.length });
    return { sceneAudio, costs: [ttsCost] };
  });

  await setVideoStatus(videoId, "fetching_stock");
  const boss = await getBoss();
  await boss.send(QUEUES.FETCH_STOCK_FOOTAGE, { videoId });
}
