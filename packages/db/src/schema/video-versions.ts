import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { feedback } from "./feedback";
import { videos } from "./videos";

export const videoVersions = pgTable(
  "video_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id),
    versionNumber: integer("version_number").notNull(),
    script: text("script"),
    scenes: jsonb("scenes"),
    sceneAudio: jsonb("scene_audio"),
    sceneClips: jsonb("scene_clips"),
    edl: jsonb("edl"),
    renderOutputPath: text("render_output_path").notNull(),
    durationSeconds: integer("duration_seconds"),
    triggeredByFeedbackId: uuid("triggered_by_feedback_id").references(() => feedback.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("video_versions_video_version_idx").on(t.videoId, t.versionNumber)],
);

export type VideoVersion = typeof videoVersions.$inferSelect;
export type NewVideoVersion = typeof videoVersions.$inferInsert;
