import { db, generationJobs, videos, type JobType, type NewGenerationJob, type VideoStatus } from "@video-generator/db";
import { eq } from "drizzle-orm";
import { logger } from "../util/logger";
import type { StageDefinition } from "./stage-context";

export async function beginStage(
  videoId: string,
  stage: StageDefinition,
  inputPayload?: unknown,
): Promise<string> {
  await db.update(videos).set({ status: stage.activeStatus, updatedAt: new Date() }).where(eq(videos.id, videoId));

  const jobRow: NewGenerationJob = {
    videoId,
    jobType: stage.jobType,
    status: "active",
    startedAt: new Date(),
    inputPayload: inputPayload ? (inputPayload as object) : undefined,
  };
  const [inserted] = await db.insert(generationJobs).values(jobRow).returning({ id: generationJobs.id });
  return inserted!.id;
}

export async function completeStage(jobId: string, outputPayload?: unknown): Promise<void> {
  await db
    .update(generationJobs)
    .set({ status: "completed", completedAt: new Date(), outputPayload: outputPayload as object })
    .where(eq(generationJobs.id, jobId));
}

export async function failStage(videoId: string, jobId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Stage failed for video ${videoId}: ${message}`);
  await db
    .update(generationJobs)
    .set({ status: "failed", completedAt: new Date(), errorMessage: message })
    .where(eq(generationJobs.id, jobId));
  await db
    .update(videos)
    .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
    .where(eq(videos.id, videoId));
}

export async function setVideoStatus(
  videoId: string,
  status: VideoStatus,
  patch: Partial<typeof videos.$inferInsert> = {},
): Promise<void> {
  await db.update(videos).set({ status, ...patch, updatedAt: new Date() }).where(eq(videos.id, videoId));
}

/** Wraps a stage handler body with the begin/complete/fail bookkeeping above. */
export async function runStage<T>(
  videoId: string,
  stage: StageDefinition,
  fn: () => Promise<T>,
): Promise<T> {
  const jobId = await beginStage(videoId, stage);
  try {
    const result = await fn();
    await completeStage(jobId, result as unknown);
    return result;
  } catch (error) {
    await failStage(videoId, jobId, error);
    throw error;
  }
}

export type { JobType };
