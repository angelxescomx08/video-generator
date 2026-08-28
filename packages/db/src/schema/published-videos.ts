import { index, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { platformAccounts, type Platform } from "./platform-accounts";
import { videos } from "./videos";

export const PUBLISH_STATUSES = ["published", "failed", "removed"] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

export const publishedVideos = pgTable(
  "published_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id),
    platformAccountId: uuid("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id),
    platform: text("platform").notNull().$type<Platform>(),
    externalVideoId: text("external_video_id").notNull(),
    externalUrl: text("external_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    status: text("status").notNull().default("published").$type<PublishStatus>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueExternal: uniqueIndex("published_videos_account_external_unique").on(
      table.platformAccountId,
      table.externalVideoId,
    ),
    /** Todo el pipeline de analiticas entra por aqui: video -> su publicacion -> sus snapshots. */
    byVideo: index("published_videos_video_idx").on(table.videoId),
    /** El poll cada 6h y las analiticas globales solo miran los vinculos vivos. */
    byStatus: index("published_videos_status_idx").on(table.status),
  }),
);

export type PublishedVideo = typeof publishedVideos.$inferSelect;
export type NewPublishedVideo = typeof publishedVideos.$inferInsert;
