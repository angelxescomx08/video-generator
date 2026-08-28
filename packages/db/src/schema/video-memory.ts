import { index, jsonb, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";
import { themes } from "./themes";
import { videos } from "./videos";

export const MEMORY_CONTENT_TYPES = [
  "script",
  "topic_summary",
  "feedback_summary",
  "style_note",
] as const;
export type MemoryContentType = (typeof MEMORY_CONTENT_TYPES)[number];

/**
 * Embedding dimension defaults to 768 to match Ollama's `nomic-embed-text` (the default
 * EMBEDDING_PROVIDER). If EMBEDDING_PROVIDER is switched to OpenAI (1536 dims) or another
 * model with a different size, regenerate a migration changing this column's dimension.
 */
export const EMBEDDING_DIMENSIONS = 768;

export const videoMemory = pgTable(
  "video_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    themeId: uuid("theme_id")
      .notNull()
      .references(() => themes.id),
    videoId: uuid("video_id").references(() => videos.id),
    contentType: text("content_type").notNull().$type<MemoryContentType>(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("video_memory_theme_idx").on(t.themeId),
    /**
     * Sin este indice la busqueda por similitud es un escaneo secuencial que calcula la distancia
     * coseno contra CADA fila: a un guion por video, mil videos son mil productos punto de 768
     * dimensiones en cada generacion. HNSW lo vuelve logaritmico.
     *
     * Tiene que coincidir con el operador que usa la consulta: `retrieveMemoryContext` ordena por
     * `cosineDistance`, asi que el indice es `vector_cosine_ops`. Si esa consulta cambiara a
     * distancia L2, este indice dejaria de usarse sin que nada falle.
     */
    index("video_memory_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export type VideoMemory = typeof videoMemory.$inferSelect;
export type NewVideoMemory = typeof videoMemory.$inferInsert;
