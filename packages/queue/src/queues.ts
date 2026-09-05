import { z } from "zod";

export const QUEUES = {
  GENERATE_SCRIPT: "generate-script",
  GENERATE_TTS: "generate-tts",
  FETCH_STOCK_FOOTAGE: "fetch-stock-footage",
  BUILD_EDL: "build-edl",
  RENDER_VIDEO: "render-video",
  PUBLISH_VIDEO: "publish-video",
  POLL_STATS: "poll-stats",
  /** Descubrimiento de dimensiones nuevas: no toca ningun video, analiza el canal entero. */
  DISCOVER_DIMENSIONS: "discover-dimensions",
  /**
   * Etiqueta los videos que todavia no tienen respuesta para alguna dimension descubierta activa.
   *
   * Existe porque el descubrimiento etiqueta el canal UNA vez, cuando nace la pregunta: sin esta
   * cola, los videos publicados despues nunca se clasifican y la dimension se queda congelada con
   * la muestra que tenia el dia que se creo. Es idempotente (el unique de
   * `video_dimension_labels` absorbe los reintentos), asi que se puede disparar de mas sin costo.
   */
  LABEL_DIMENSIONS: "label-dimensions",
  /** Busca en la web y propone temas de video nuevos para un tema del canal. */
  DISCOVER_TOPICS: "discover-topics",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Every stage queue takes only a videoId — all real state lives in Postgres (videos/generation_jobs). */
export const videoJobPayloadSchema = z.object({
  videoId: z.string().uuid(),
});
export type VideoJobPayload = z.infer<typeof videoJobPayloadSchema>;

export const publishJobPayloadSchema = z.object({
  videoId: z.string().uuid(),
  platformAccountId: z.string().uuid(),
});
export type PublishJobPayload = z.infer<typeof publishJobPayloadSchema>;

/** videoId omitted means "poll all published videos" (used by the recurring cron schedule). */
export const pollStatsPayloadSchema = z.object({
  videoId: z.string().uuid().optional(),
});
export type PollStatsPayload = z.infer<typeof pollStatsPayloadSchema>;

/** El descubrimiento de temas es por tema del canal: cada uno busca cosas distintas. */
export const discoverTopicsPayloadSchema = z.object({
  themeId: z.string().uuid(),
  /** Consulta libre del usuario. Sin ella, se derivan consultas del propio tema. */
  query: z.string().optional(),
});
export type DiscoverTopicsPayload = z.infer<typeof discoverTopicsPayloadSchema>;
