import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { videos } from "./videos";

export const DIMENSION_OUTCOMES = ["avgViewPercentage", "retentionAtStart"] as const;
export type DimensionOutcome = (typeof DIMENSION_OUTCOMES)[number];

export const DIMENSION_STATUSES = ["active", "retired"] as const;
export type DimensionStatus = (typeof DIMENSION_STATUSES)[number];

/**
 * Dimensiones de aprendizaje DESCUBIERTAS por la IA, sobre el contenido del guion.
 *
 * El motor de `@video-generator/analytics` trae una lista fija de dimensiones escrita a mano
 * (gancho, ritmo, efectos...). Esa lista es su techo: puede responder muy bien esas preguntas y
 * ninguna otra, y no se le puede ocurrir mirar algo que nadie programo. Esta tabla es la salida de
 * ese techo — la IA lee los guiones que mejor y peor rindieron, propone una pregunta que los
 * distinga ("¿el guion cuenta una historia con protagonista o expone datos sueltos?") y esa pregunta
 * pasa a medirse como una dimension mas.
 *
 * El reparto de trabajo es deliberado: **la IA propone, el dato dispone.** Un LLM es bueno generando
 * hipotesis y pesimo validandolas — con diez videos te "encuentra" patrones que son ruido puro. Por
 * eso lo unico que aporta es la pregunta; quien decide si esa pregunta significa algo es el mismo
 * motor de agregacion que ya filtra por muestra y por diferencia minima. Una hipotesis absurda
 * simplemente nunca produce una leccion y se ignora sola.
 */
export const learningDimensions = pgTable(
  "learning_dimensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nombre corto con el que se muestra la dimension ("estructura del guion"). */
    label: text("label").notNull(),
    /** La pregunta EXACTA que se le hace al clasificador sobre cada guion. */
    question: text("question").notNull(),
    /** Respuestas permitidas. El clasificador debe contestar una de estas, literal. */
    buckets: text("buckets").array().notNull(),
    /** Con que metrica se califica esta dimension. Ver `Outcomes` en analytics/learnings.ts. */
    outcome: text("outcome").notNull().$type<DimensionOutcome>(),
    /** Por que la IA propuso esta pregunta. Se guarda para poder juzgar la hipotesis, no solo el resultado. */
    rationale: text("rationale").notNull(),
    status: text("status").notNull().default("active").$type<DimensionStatus>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("learning_dimensions_status_idx").on(t.status)],
);

/**
 * La respuesta del clasificador para un (video, dimension). Se guarda en vez de recalcularse porque
 * clasificar es una llamada al LLM por video: sin cache, cada visita a la pantalla de analiticas
 * volveria a pagar por etiquetar el canal entero.
 */
export const videoDimensionLabels = pgTable(
  "video_dimension_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id),
    dimensionId: uuid("dimension_id")
      .notNull()
      .references(() => learningDimensions.id),
    /** Uno de los `buckets` de la dimension. */
    bucket: text("bucket").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Un video se clasifica UNA vez por dimension; el unique es lo que hace que reintentar el job
    // sea seguro y no duplique etiquetas ni gasto.
    unique("video_dimension_labels_video_dimension_key").on(t.videoId, t.dimensionId),
    index("video_dimension_labels_dimension_idx").on(t.dimensionId),
  ],
);
