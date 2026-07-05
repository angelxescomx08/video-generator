import { z } from "zod";

export const QUEUES = {
  GENERATE_SCRIPT: "generate-script",
  GENERATE_TTS: "generate-tts",
  FETCH_STOCK_FOOTAGE: "fetch-stock-footage",
  BUILD_EDL: "build-edl",
  RENDER_VIDEO: "render-video",
  PUBLISH_VIDEO: "publish-video",
  POLL_STATS: "poll-stats",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Every stage queue takes only a videoId — all real state lives in Postgres (videos/generation_jobs). */
export const videoJobPayloadSchema = z.object({
  videoId: z.string().uuid(),
});
export type VideoJobPayload = z.infer<typeof videoJobPayloadSchema>;

export const publishJobPayloadSchema = z.object({
  videoId: z.string().uuid(),
  platformAccountId: z.string().uuid(),
});
export type PublishJobPayload = z.infer<typeof publishJobPayloadSchema>;

/** videoId omitted means "poll all published videos" (used by the recurring cron schedule). */
export const pollStatsPayloadSchema = z.object({
  videoId: z.string().uuid().optional(),
});
export type PollStatsPayload = z.infer<typeof pollStatsPayloadSchema>;
