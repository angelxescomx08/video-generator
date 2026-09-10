import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const STATS_SYNC_STATUSES = ["queued", "active", "completed"] as const;
export type StatsSyncStatus = (typeof STATS_SYNC_STATUSES)[number];

/** Persisted user-triggered refresh. Scheduled polls intentionally do not create these rows. */
export const statsSyncRuns = pgTable(
  "stats_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull().default("queued").$type<StatsSyncStatus>(),
    totalCount: integer("total_count").notNull(),
    completedCount: integer("completed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stats_sync_runs_created_idx").on(t.createdAt.desc())],
);
