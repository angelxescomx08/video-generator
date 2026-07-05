import { resolveProvider } from "@video-generator/ai-providers";
import type { ScriptScene } from "@video-generator/ai-providers";
import { db, videos } from "@video-generator/db";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { editDecisionListSchema, buildFallbackEdl, type EditDecisionList } from "@video-generator/types";
import type { StockClipRef } from "@video-generator/types";
import { eq } from "drizzle-orm";
import path from "node:path";
import { concatAudioFiles } from "../ffmpeg/concat-audio";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
import { getJobWorkspace } from "../util/tmp-workspace";
import { logger } from "../util/logger";

interface SceneAudio {
  sceneIndex: number;
  audioFilePath: string;
  durationSeconds: number;
}

interface SceneClip {
  sceneIndex: number;
  clip: StockClipRef;
  localPath: string;
}

export async function handleBuildEdl(payload: VideoJobPayload): Promise<void> {
  const { videoId } = videoJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);

  const scenes = (video.scenes as ScriptScene[] | null) ?? [];
  const sceneAudio = (video.sceneAudio as SceneAudio[] | null) ?? [];
  const sceneClips = (video.sceneClips as SceneClip[] | null) ?? [];
  if (scenes.length === 0 || sceneAudio.length === 0 || sceneClips.length === 0) {
    throw new Error(`Video ${videoId} is missing scenes/audio/clips required to build the EDL`);
  }

  await runStage(videoId, STAGES.edl!, async () => {
    const workspace = await getJobWorkspace(videoId);

    const voiceoverPath = path.join(workspace, "voiceover.wav");
    await concatAudioFiles(
      sceneAudio.sort((a, b) => a.sceneIndex - b.sceneIndex).map((s) => s.audioFilePath),
      voiceoverPath,
      workspace,
    );

    const provider = await resolveProvider();
    let edl: EditDecisionList;
    try {
      const raw = await provider.generateEDL({
        scenes,
        availableClips: sceneClips.map((sc) => sc.clip),
        format: video.format,
        themeSlug: "",
      });
      const parsed = editDecisionListSchema.safeParse(raw);
      if (!parsed.success) throw new Error(parsed.error.message);
      edl = parsed.data;
    } catch (err) {
      logger.warn(`AI EDL generation failed for video ${videoId}, using deterministic fallback`, {
        error: (err as Error).message,
      });
      edl = buildFallbackEdl({
        format: video.format,
        voiceoverPath,
        scenes: sceneAudio
          .sort((a, b) => a.sceneIndex - b.sceneIndex)
          .map((sa) => {
            const clip = sceneClips.find((sc) => sc.sceneIndex === sa.sceneIndex)!;
            const scene = scenes.find((s) => s.index === sa.sceneIndex);
            return {
              sourcePath: clip.localPath,
              mediaType: clip.clip.mediaType,
              durationSeconds: sa.durationSeconds,
              captionText: scene?.captionText ?? scene?.narrationText,
            };
          }),
      });
    }

    // Fill in file paths the LLM doesn't know about (it only reasoned about scene indices/keywords).
    edl.audio.voiceoverPath = voiceoverPath;
    edl.scenes = edl.scenes.map((s) => {
      const clip = sceneClips.find((sc) => sc.sceneIndex === s.index);
      return clip ? { ...s, clip: { sourcePath: clip.localPath, mediaType: clip.clip.mediaType } } : s;
    });

    await db.update(videos).set({ edl, updatedAt: new Date() }).where(eq(videos.id, videoId));

    logger.info(`EDL built for video ${videoId}`, { scenes: edl.scenes.length });
    return edl;
  });

  await setVideoStatus(videoId, "rendering");
  const boss = await getBoss();
  await boss.send(QUEUES.RENDER_VIDEO, { videoId });
}
