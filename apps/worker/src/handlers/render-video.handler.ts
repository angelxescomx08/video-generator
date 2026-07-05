import { db, videos } from "@video-generator/db";
import { videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import type { EditDecisionList } from "@video-generator/types";
import { eq } from "drizzle-orm";
import path from "node:path";
import { buildFfmpegArgs } from "../ffmpeg/edl-to-ffmpeg";
import { logFfmpegProgress, runFfmpeg } from "../ffmpeg/render";
import { buildAssSubtitleFile } from "../ffmpeg/srt-builder";
import { resolutionForFormat } from "../ffmpeg/edl-to-ffmpeg";
import { runStage } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
import { getJobWorkspace, getRenderOutputPath } from "../util/tmp-workspace";
import { logger } from "../util/logger";

export async function handleRenderVideo(payload: VideoJobPayload): Promise<void> {
  const { videoId } = videoJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  const edl = video.edl as EditDecisionList | null;
  if (!edl) throw new Error(`Video ${videoId} has no EDL to render`);

  await runStage(videoId, STAGES.render!, async () => {
    const workspace = await getJobWorkspace(videoId);
    const outputPath = await getRenderOutputPath(videoId);

    let assFilePath: string | undefined;
    if (edl.captions.enabled) {
      const { width, height } = resolutionForFormat(edl.format);
      assFilePath = await buildAssSubtitleFile({
        scenes: edl.scenes,
        style: edl.captions.style,
        resolutionWidth: width,
        resolutionHeight: height,
        destPath: path.join(workspace, "captions.ass"),
      });
    }

    const args = buildFfmpegArgs(edl, {
      assFilePath,
      backgroundMusicPath: edl.audio.backgroundMusicPath,
      outputPath,
    });

    logger.info(`Starting ffmpeg render for video ${videoId}`);
    await runFfmpeg(args, logFfmpegProgress(videoId));

    await db
      .update(videos)
      .set({
        renderOutputPath: outputPath,
        durationSeconds: Math.round(edl.totalDurationSeconds),
        status: "ready",
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));

    logger.info(`Render complete for video ${videoId}`, { outputPath });
    return { outputPath };
  });
}
