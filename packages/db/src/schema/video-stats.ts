import { bigint, jsonb, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { publishedVideos } from "./published-videos";

export const videoStats = pgTable("video_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  publishedVideoId: uuid("published_video_id")
    .notNull()
    .references(() => publishedVideos.id),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  views: bigint("views", { mode: "number" }),
  likes: bigint("likes", { mode: "number" }),
  comments: bigint("comments", { mode: "number" }),
  shares: bigint("shares", { mode: "number" }),
  avgViewDurationSeconds: numeric("avg_view_duration_seconds"),
  avgViewPercentage: numeric("avg_view_percentage"),
  impressions: bigint("impressions", { mode: "number" }),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VideoStats = typeof videoStats.$inferSelect;
export type NewVideoStats = typeof videoStats.$inferInsert;
