import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { themes } from "./themes";
import { videos } from "./videos";

export const FEEDBACK_SOURCES = ["manual", "auto_derived_from_stats"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  videoId: uuid("video_id")
    .notNull()
    .references(() => videos.id),
  themeId: uuid("theme_id")
    .notNull()
    .references(() => themes.id),
  rating: integer("rating"),
  structuredRatings: jsonb("structured_ratings"),
  comment: text("comment"),
  source: text("source").notNull().default("manual").$type<FeedbackSource>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
