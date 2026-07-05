import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { themes } from "./themes";

export const VIDEO_FORMATS = ["long", "short"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const VIDEO_STATUSES = [
  "draft",
  "queued",
  "generating_script",
  "generating_tts",
  "fetching_stock",
  "building_edl",
  "rendering",
  "ready",
  "publishing",
  "published",
  "failed",
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const videos = pgTable("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  themeId: uuid("theme_id")
    .notNull()
    .references(() => themes.id),
  format: text("format").notNull().$type<VideoFormat>(),
  topic: text("topic"),
  title: text("title"),
  description: text("description"),
  status: text("status").notNull().default("draft").$type<VideoStatus>(),
  script: text("script"),
  scenes: jsonb("scenes"),
  sceneAudio: jsonb("scene_audio"),
  sceneClips: jsonb("scene_clips"),
  edl: jsonb("edl"),
  renderOutputPath: text("render_output_path"),
  durationSeconds: integer("duration_seconds"),
  errorMessage: text("error_message"),
  requestedBy: text("requested_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
