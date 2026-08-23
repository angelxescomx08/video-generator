import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Biblioteca de canciones subidas por el usuario, independiente de cualquier video: se sube una vez
 * y se puede reutilizar en varios videos.
 *
 * El archivo vive en MUSIC_LIBRARY_DIR (apps/web lo escribe al subir, apps/worker lo lee al
 * renderizar); aqui solo se guarda la ruta y los metadatos.
 */
export const musicTracks = pgTable("music_tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  artist: text("artist"),
  /** Ruta absoluta del archivo dentro de MUSIC_LIBRARY_DIR. */
  filePath: text("file_path").notNull(),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  /** Medida en el navegador con un elemento <audio> al subir: apps/web no debe ejecutar ffprobe. */
  durationSeconds: integer("duration_seconds"),
  /** Generos de la Biblioteca de audio de YouTube (YoutubeAudioGenre[]) elegidos al subir. */
  genres: jsonb("genres").$type<string[]>().notNull().default([]),
  /** Estados de animo de la Biblioteca de audio de YouTube (YoutubeAudioMood[]). */
  moods: jsonb("moods").$type<string[]>().notNull().default([]),
  /** Credito/licencia de la pista, si aplica — el usuario es responsable de tener derecho a usarla. */
  attribution: text("attribution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MusicTrack = typeof musicTracks.$inferSelect;
export type NewMusicTrack = typeof musicTracks.$inferInsert;
