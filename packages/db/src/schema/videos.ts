import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { themes } from "./themes";

export const VIDEO_FORMATS = ["long", "short"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const VIDEO_STATUSES = [
  "draft",
  "queued",
  "generating_script",
  "generating_tts",
  "fetching_stock",
  "building_edl",
  "rendering",
  "ready",
  "publishing",
  "published",
  "failed",
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    themeId: uuid("theme_id")
      .notNull()
      .references(() => themes.id),
    format: text("format").notNull().$type<VideoFormat>(),
    topic: text("topic"),
    /** Subtitulos quemados en el video. Desactivados por defecto (ver edl.captions.enabled). */
    captionsEnabled: boolean("captions_enabled").notNull().default(false),
    /**
     * TECHO de duracion del guion en segundos, elegido por el usuario — no un objetivo exacto.
     *
     * El video puede salir mas corto (hasta el piso que deriva `resolveDurationBand` a partir de
     * este numero y del formato) pero no mas largo; el nombre conserva "target" porque es tambien el
     * tiempo de referencia que se escribio, y renombrar la columna no cambiaria nada del calculo.
     * Si es null, el builder usa el default del formato.
     */
    targetDurationSeconds: integer("target_duration_seconds"),
    title: text("title"),
    description: text("description"),
    /** Tags de YouTube (no hashtags) sugeridos por la IA en generate-script — se envian tal cual al publicar. */
    tags: jsonb("tags").$type<string[]>(),
    status: text("status").notNull().default("draft").$type<VideoStatus>(),
    script: text("script"),
    scenes: jsonb("scenes"),
    sceneAudio: jsonb("scene_audio"),
    sceneClips: jsonb("scene_clips"),
    edl: jsonb("edl"),
    renderOutputPath: text("render_output_path"),
    durationSeconds: integer("duration_seconds"),
    errorMessage: text("error_message"),
    requestedBy: text("requested_by"),
    /** Video actualmente activo en video_versions; sin FK para evitar el ciclo videos<->video_versions. */
    currentVersionId: uuid("current_version_id"),
    /** Feedback que disparo la regeneracion en curso; se limpia al completar el render. */
    pendingFeedbackId: uuid("pending_feedback_id"),
    /**
     * El experimento que se le asigno a este video (`ExplorationChoice` del worker), si lleva uno.
     *
     * Vive en la fila del video y no en el payload de la cola porque el experimento se DECIDE al
     * escribir el guion pero algunos se APLICAN al montar el EDL, dos stages despues. Sin esto, la
     * etapa del EDL no tiene forma de saber que este video venia con instrucciones, y las
     * dimensiones que se deciden en el pipeline (el golpe visual del gancho, por ejemplo) no se
     * pueden experimentar nunca: quedan clavadas en lo que diga la guia por defecto.
     */
    explorationPlan: jsonb("exploration_plan"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** El dashboard y las analiticas ordenan por fecha de creacion y cortan; sin esto es un sort
     * de la tabla completa en cada carga. */
    index("videos_created_at_idx").on(t.createdAt.desc()),
    index("videos_theme_idx").on(t.themeId),
    index("videos_status_idx").on(t.status),
  ],
);

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
