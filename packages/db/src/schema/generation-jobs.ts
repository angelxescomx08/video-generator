import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { videos } from "./videos";
import { videoVersions } from "./video-versions";

export const JOB_TYPES = [
  "script",
  "tts",
  "stock_footage",
  "edl",
  "render",
  "publish",
  "stats_poll",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["pending", "active", "completed", "failed", "retried"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id),
    /** Se asigna cuando render-video.handler.ts crea la version que "reclama" este job para su costo. */
    videoVersionId: uuid("video_version_id").references(() => videoVersions.id),
    jobType: text("job_type").notNull().$type<JobType>(),
    pgbossJobId: uuid("pgboss_job_id"),
    status: text("status").notNull().default("pending").$type<JobStatus>(),
    attempt: integer("attempt").notNull().default(0),
    inputPayload: jsonb("input_payload"),
    outputPayload: jsonb("output_payload"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** `attributeCostsToVersion` busca los jobs sin version de un video en cada render. */
    index("generation_jobs_video_version_idx").on(t.videoId, t.videoVersionId),
    /** El panel de progreso de la generacion lee los jobs de un video ordenados por creacion. */
    index("generation_jobs_video_created_idx").on(t.videoId, t.createdAt),
  ],
);

export type GenerationJob = typeof generationJobs.$inferSelect;
export type NewGenerationJob = typeof generationJobs.$inferInsert;
