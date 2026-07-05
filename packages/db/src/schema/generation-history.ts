import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { themes } from "./themes";
import { videos } from "./videos";

export const FACT_TYPES = [
  "topic_covered",
  "bible_verse_used",
  "quote_used",
  "title_used",
] as const;
export type FactType = (typeof FACT_TYPES)[number];

export const generationHistory = pgTable(
  "generation_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    themeId: uuid("theme_id")
      .notNull()
      .references(() => themes.id),
    videoId: uuid("video_id").references(() => videos.id),
    factType: text("fact_type").notNull().$type<FactType>(),
    factValue: text("fact_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueFact: uniqueIndex("generation_history_theme_fact_unique").on(
      table.themeId,
      table.factType,
      table.factValue,
    ),
  }),
);

export type GenerationHistory = typeof generationHistory.$inferSelect;
export type NewGenerationHistory = typeof generationHistory.$inferInsert;
