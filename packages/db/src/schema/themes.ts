import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  scriptPromptTemplate: text("script_prompt_template").notNull(),
  edlPromptTemplate: text("edl_prompt_template"),
  defaultVoiceId: text("default_voice_id"),
  defaultMusicTags: text("default_music_tags").array(),
  /** Categoria de YouTube (categoryId de la API) para los videos de este tema. YouTube no tiene
   * categoria de religion, asi que el contenido cristiano suele ir en "27" (Educacion) si ensena o
   * "22" (Gente y blogs) si es testimonio — ver packages/types/src/youtube-categories.ts. */
  youtubeCategoryId: text("youtube_category_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Theme = typeof themes.$inferSelect;
export type NewTheme = typeof themes.$inferInsert;
