import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const DISCOVERY_RUN_STATUSES = ["running", "completed", "failed"] as const;
export type DiscoveryRunStatus = (typeof DISCOVERY_RUN_STATUSES)[number];

/**
 * Bitacora de cada corrida del descubrimiento de dimensiones.
 *
 * No es telemetria: es lo que hace posible bloquear el boton cuando volver a correrlo no aporta.
 * Sin registrar sobre cuanta muestra se corrio la ultima vez, no hay forma de distinguir "hay
 * material nuevo que mirar" de "es exactamente la misma muestra otra vez", y volver a preguntarle a
 * los mismos datos hasta que salga algo distinto es la definicion de p-hacking.
 *
 * `sampleCount` es la cifra que importa comparar, no la fecha: lo que agota una corrida es haber
 * mirado ESOS videos, no el tiempo transcurrido.
 */
export const dimensionDiscoveryRuns = pgTable(
  "dimension_discovery_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running").$type<DiscoveryRunStatus>(),
    /** Videos medibles que habia cuando se corrio. Es la vara contra la que se mide "hay algo nuevo". */
    sampleCount: integer("sample_count").notNull(),
    /** Cuantas dimensiones quedaron activas de esta corrida. */
    proposedCount: integer("proposed_count").notNull().default(0),
    errorMessage: text("error_message"),
  },
  (t) => [
    // Las dos consultas que existen son "¿hay una corriendo?" y "¿cual fue la ultima?"; ambas
    // recorren este indice en vez de ordenar la tabla.
    index("dimension_discovery_runs_started_idx").on(t.startedAt),
    index("dimension_discovery_runs_status_idx").on(t.status),
  ],
);
