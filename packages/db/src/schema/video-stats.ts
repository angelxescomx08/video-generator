import { bigint, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { publishedVideos } from "./published-videos";

export const STATS_SOURCES = ["api", "manual"] as const;
export type StatsSource = (typeof STATS_SOURCES)[number];

/**
 * Una foto del rendimiento de un video publicado en un momento dado. Se acumulan varias por video
 * (el poll recurrente inserta una cada 6h), nunca se actualizan — el historico es lo que permite ver
 * como evoluciono y comparar videos a la misma edad.
 *
 * Casi todas las columnas son nullable a proposito: YouTube libera cada metrica en un momento
 * distinto (la curva de retencion tarda ~48h, el CTR no existe en Shorts) y un `null` significa
 * "todavia no hay dato", que es informacion distinta de un 0. El motor de aprendizaje
 * (@video-generator/analytics) descarta nulls en vez de tratarlos como cero.
 *
 * Que significa cada metrica y donde encontrarla a mano esta documentado una sola vez, en
 * YOUTUBE_METRICS (packages/types/src/youtube-metrics.ts) — la UI y el provider leen de ahi.
 */
export const videoStats = pgTable(
  "video_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publishedVideoId: uuid("published_video_id")
      .notNull()
      .references(() => publishedVideos.id),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    /** 'api' si lo jalo el provider, 'manual' si el usuario lo escribio en /videos/[id]/performance. */
    source: text("source").notNull().default("api").$type<StatsSource>(),
    /** Edad del video en dias al momento de capturar — sin esto, comparar dos snapshots es invalido. */
    videoAgeDays: integer("video_age_days"),

    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    impressions: bigint("impressions", { mode: "number" }),
    /** Veces que alguien vio mas alla de los primeros segundos: el tamano de muestra real. */
    engagedViews: bigint("engaged_views", { mode: "number" }),
    subscribersGained: bigint("subscribers_gained", { mode: "number" }),
    subscribersLost: bigint("subscribers_lost", { mode: "number" }),

    avgViewDurationSeconds: numeric("avg_view_duration_seconds"),
    avgViewPercentage: numeric("avg_view_percentage"),
    watchTimeHours: numeric("watch_time_hours"),
    /** CTR de impresiones en %. Mide titulo/miniatura, no el guion. */
    impressionsCtr: numeric("impressions_ctr"),
    /** Shorts: % que no hizo swipe inmediato ('Se quedaron viendo' en Studio). */
    stayedToWatchPercentage: numeric("stayed_to_watch_percentage"),
    /** % que seguia viendo al segundo 3 — la nota del gancho, derivada de la curva de retencion. */
    retentionAtStartPercentage: numeric("retention_at_start_percentage"),

    /** Curva completa: RetentionPoint[] de @video-generator/types. Null hasta que YouTube la calcula. */
    retentionCurve: jsonb("retention_curve"),
    /** Reparto por fuente de trafico (feed de Shorts, busqueda, sugeridos...). */
    trafficSources: jsonb("traffic_sources"),
    /** Nota libre que el usuario escribio al capturar a mano ("lo compartio una cuenta grande"). */
    notes: text("notes"),

    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Esta es la tabla que crece sin techo: un video publicado inserta un snapshot cada 6h para
     * siempre, asi que con 1000 videos y medio ano de historia son ~700k filas. Las dos consultas
     * que la leen son siempre las mismas y ninguna quiere la tabla entera.
     *
     * Este indice sirve a las dos: el `DISTINCT ON (published_video_id) ... ORDER BY captured_at
     * DESC` que arma la foto mas reciente de cada video (recorre el indice por grupos en vez de
     * ordenar toda la tabla) y el historial de un solo video en su pantalla de rendimiento.
     */
    index("video_stats_published_captured_idx").on(t.publishedVideoId, t.capturedAt.desc()),
    /** La serie de tiempo del canal barre por fecha sin filtrar por video. */
    index("video_stats_captured_idx").on(t.capturedAt.desc()),
  ],
);

export type VideoStats = typeof videoStats.$inferSelect;
export type NewVideoStats = typeof videoStats.$inferInsert;
