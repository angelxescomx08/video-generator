import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { themes } from "./themes";
import { videos } from "./videos";

export const TOPIC_PROPOSAL_STATUSES = ["pending", "approved", "rejected", "duplicate"] as const;
export type TopicProposalStatus = (typeof TOPIC_PROPOSAL_STATUSES)[number];

/**
 * Ideas de video que propuso el sistema despues de buscar en la web.
 *
 * Se guardan en vez de mostrarse y olvidarse por una razon concreta: lo caro de esto no es proponer,
 * es DESCARTAR. Cada propuesta ya pago una busqueda web, una llamada al LLM y un embedding para
 * comprobar si el canal ya conto algo parecido. Sin tabla, la siguiente corrida vuelve a proponer lo
 * mismo y vuelve a pagar por descubrir que era repetido — y peor, no hay forma de que el prompt de
 * la proxima corrida sepa que esa idea ya se rechazo.
 *
 * `duplicate` es un estado distinto de `rejected` a proposito: rechazado es un juicio del usuario
 * ("no me interesa"), duplicado es un hecho medido contra los guiones anteriores. Mezclarlos haria
 * imposible distinguir "el detector de repetidos esta funcionando" de "las ideas no gustan".
 */
export const topicProposals = pgTable(
  "topic_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    themeId: uuid("theme_id")
      .notNull()
      .references(() => themes.id),
    /** Titulo de trabajo de la idea; el titulo real del video lo escribe despues generate-script. */
    title: text("title").notNull(),
    /** La idea desarrollada. Es lo que se copia a `videos.topic` al aprobar. */
    idea: text("idea").notNull(),
    /** Por que engancharia, en una frase. Se guarda para poder juzgar la propuesta, no el resultado. */
    angle: text("angle").notNull(),
    /** Las fuentes web en las que se apoya (`TopicResearchSource[]`), para poder verificarla. */
    sources: jsonb("sources").$type<Array<{ title: string; url: string; source: string }>>(),
    status: text("status").notNull().default("pending").$type<TopicProposalStatus>(),
    /**
     * Similitud coseno con el guion anterior mas parecido (0-1).
     *
     * Se guarda aunque la propuesta pase el filtro: es lo que permite ver en la UI *cuanto* se
     * parece a lo ya hecho y ajustar el umbral con datos en vez de a ojo.
     */
    similarityScore: text("similarity_score"),
    /** El video anterior al que se parece, si lo hay. Es el "parecido a X" que se muestra. */
    similarToVideoId: uuid("similar_to_video_id").references(() => videos.id),
    /** El video que se creo al aprobarla, si se aprobo. */
    createdVideoId: uuid("created_video_id").references(() => videos.id),
    /** La consulta de busqueda que la origino, para poder reproducir de donde salio. */
    searchQuery: text("search_query"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("topic_proposals_status_idx").on(t.status),
    index("topic_proposals_created_at_idx").on(t.createdAt.desc()),
  ],
);

export type TopicProposal = typeof topicProposals.$inferSelect;
export type NewTopicProposal = typeof topicProposals.$inferInsert;
