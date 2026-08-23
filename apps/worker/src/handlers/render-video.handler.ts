import {
  db,
  generationJobs,
  videoVersions,
  videos,
  appSettings,
  USD_TO_MXN_RATE_KEY,
  DEFAULT_USD_TO_MXN_RATE,
} from "@video-generator/db";
import { videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import type { CostItem, EditDecisionList } from "@video-generator/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import path from "node:path";
import { buildFfmpegArgs } from "../ffmpeg/edl-to-ffmpeg";
import { logFfmpegProgress, runFfmpeg } from "../ffmpeg/render";
import { buildAssSubtitleFile } from "../ffmpeg/srt-builder";
import { resolutionForFormat } from "../ffmpeg/edl-to-ffmpeg";
import { runStage } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
import { getJobWorkspace, getRenderOutputPath } from "../util/tmp-workspace";
import { logger } from "../util/logger";

const RENDER_COST: CostItem = {
  stage: "render",
  providerType: "render",
  providerName: "ffmpeg",
  isFree: true,
  isLocal: true,
  amountUsd: 0,
};

/**
 * Junta el costo de todos los generation_jobs de este ciclo de generacion (los que aun no estan
 * atados a ninguna version) + el de renderizar, lo guarda en la version recien creada, y marca
 * esos jobs con videoVersionId para que la siguiente regeneracion no los vuelva a contar.
 */
async function attributeCostsToVersion(videoId: string, versionId: string): Promise<void> {
  const unattributedJobs = await db
    .select({ id: generationJobs.id, outputPayload: generationJobs.outputPayload })
    .from(generationJobs)
    .where(
      and(eq(generationJobs.videoId, videoId), isNull(generationJobs.videoVersionId), eq(generationJobs.status, "completed")),
    );

  const jobCosts = unattributedJobs.flatMap((job) => {
    const payload = job.outputPayload as { costs?: CostItem[] } | null;
    return payload?.costs ?? [];
  });
  const costBreakdown: CostItem[] = [...jobCosts, RENDER_COST];

  const rateRow = await db.query.appSettings.findFirst({ where: eq(appSettings.key, USD_TO_MXN_RATE_KEY) });
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_USD_TO_MXN_RATE;

  const costTotalUsd = costBreakdown.reduce((sum, c) => sum + c.amountUsd, 0);
  const costTotalMxn = costTotalUsd * rate;

  await db
    .update(videoVersions)
    .set({
      costBreakdown,
      costTotalUsd: costTotalUsd.toString(),
      costTotalMxn: costTotalMxn.toString(),
      exchangeRateUsed: rate.toString(),
    })
    .where(eq(videoVersions.id, versionId));

  if (unattributedJobs.length > 0) {
    await db
      .update(generationJobs)
      .set({ videoVersionId: versionId })
      .where(
        and(eq(generationJobs.videoId, videoId), isNull(generationJobs.videoVersionId), eq(generationJobs.status, "completed")),
      );
  }
}

export async function handleRenderVideo(payload: VideoJobPayload): Promise<void> {
  const { videoId } = videoJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  const edl = video.edl as EditDecisionList | null;
  if (!edl) throw new Error(`Video ${videoId} has no EDL to render`);

  await runStage(videoId, STAGES.render!, async () => {
    const workspace = await getJobWorkspace(videoId);

    const [lastVersion] = await db
      .select({ versionNumber: videoVersions.versionNumber })
      .from(videoVersions)
      .where(eq(videoVersions.videoId, videoId))
      .orderBy(desc(videoVersions.versionNumber))
      .limit(1);
    const nextVersion = (lastVersion?.versionNumber ?? 0) + 1;

    const outputPath = await getRenderOutputPath(videoId, nextVersion);

    let assFilePath: string | undefined;
    if (edl.captions.enabled) {
      const { width, height } = resolutionForFormat(edl.format);
      const subtitles = await buildAssSubtitleFile({
        scenes: edl.scenes,
        style: edl.captions.style,
        format: edl.format,
        resolutionWidth: width,
        resolutionHeight: height,
        destPath: path.join(workspace, "captions.ass"),
      });

      // Un .ass sin eventos no falla el render, pero produce un video sin subtitulos y sin ninguna
      // señal de por que — avisar aqui es la diferencia entre "no salieron" y saber la causa.
      if (subtitles.chunkCount === 0) {
        logger.warn(`Subtitulos activados pero no se genero ningun bloque para video ${videoId}`, {
          scenes: edl.scenes.length,
          scenesWithCaptionText: edl.scenes.filter((s) => s.captionText).length,
          scenesWithWordTimings: edl.scenes.filter((s) => s.captionWordTimings?.length).length,
        });
      } else {
        assFilePath = subtitles.path;
        logger.info(`Subtitulos generados para video ${videoId}`, { bloques: subtitles.chunkCount });
      }
    }

    const args = buildFfmpegArgs(edl, {
      assFilePath,
      backgroundMusicPath: edl.audio.backgroundMusicPath,
      outputPath,
    });

    logger.info(`Starting ffmpeg render for video ${videoId}`);
    await runFfmpeg(args, logFfmpegProgress(videoId));

    const durationSeconds = Math.round(edl.totalDurationSeconds);
    const [version] = await db
      .insert(videoVersions)
      .values({
        videoId,
        versionNumber: nextVersion,
        script: video.script,
        scenes: video.scenes,
        sceneAudio: video.sceneAudio,
        sceneClips: video.sceneClips,
        edl: video.edl,
        renderOutputPath: outputPath,
        durationSeconds,
        triggeredByFeedbackId: video.pendingFeedbackId,
      })
      .returning({ id: videoVersions.id });

    await db
      .update(videos)
      .set({
        renderOutputPath: outputPath,
        durationSeconds,
        status: "ready",
        currentVersionId: version!.id,
        pendingFeedbackId: null,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));

    await attributeCostsToVersion(videoId, version!.id);

    logger.info(`Render complete for video ${videoId}`, { outputPath, version: nextVersion });
    return { outputPath, version: nextVersion };
  });
}
