import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * `embedding` es un tipo aparte de `ai` porque no todo proveedor de texto sabe generar embeddings
 * (Anthropic no tiene esa API) y porque la dimension del vector tiene que coincidir con la columna
 * `video_memory.embedding`. Aun asi, no hace falta configurarlo: si no hay fila de `embedding`, se
 * usa el proveedor de `ai` seleccionado — ver resolveEmbeddingProvider().
 */
export const PROVIDER_TYPES = ["ai", "embedding", "tts", "stock", "social", "music", "search"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const providerConfigs = pgTable("provider_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerType: text("provider_type").notNull().$type<ProviderType>(),
  providerName: text("provider_name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  config: jsonb("config"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProviderConfig = typeof providerConfigs.$inferSelect;
export type NewProviderConfig = typeof providerConfigs.$inferInsert;
