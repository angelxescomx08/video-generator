/**
 * El eje del tiempo, compartido por todas las pantallas de analiticas.
 *
 * Dos ejes independientes, porque son dos preguntas distintas:
 * - **Rango**: cuanto pasado se mira. Acota el escaneo en la base.
 * - **Agrupacion**: en que tamano de cubo se juntan los datos. Solo cambia cuantas barras salen.
 *
 * Separarlos permite "el ultimo ano agrupado por mes" y "los ultimos 30 dias agrupados por dia" con
 * el mismo codigo. Todo se resuelve en SQL con `date_trunc`, asi que agrupar por ano no cuesta menos
 * de leer que agrupar por dia — lo que baja el costo es el rango, no el cubo.
 */

export const GRANULARITIES = ["day", "week", "month", "year"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const TIME_RANGES = ["30d", "90d", "12m", "24m", "all"] as const;
export type TimeRangeKey = (typeof TIME_RANGES)[number];

export interface TimeRange {
  granularity: Granularity;
  range: TimeRangeKey;
  /** Dias hacia atras que cubre el rango, o `null` si es "todo" (sin filtro de fecha). */
  days: number | null;
}

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mes",
  year: "Ano",
};

/** Como se nombra un cubo en las descripciones ("vistas nuevas por semana"). */
export const GRANULARITY_NOUNS: Record<Granularity, string> = {
  day: "dia",
  week: "semana",
  month: "mes",
  year: "ano",
};

export const RANGE_LABELS: Record<TimeRangeKey, string> = {
  "30d": "30 dias",
  "90d": "90 dias",
  "12m": "12 meses",
  "24m": "24 meses",
  all: "Todo",
};

const RANGE_DAYS: Record<TimeRangeKey, number | null> = {
  "30d": 30,
  "90d": 90,
  "12m": 365,
  "24m": 730,
  all: null,
};

/**
 * Cubos que produciria una combinacion. Sirve para avisar antes de dibujar: 730 barras diarias no
 * son una grafica, son una mancha, y la respuesta correcta es agrupar mas grueso.
 */
export function bucketCount({ granularity, days }: TimeRange): number | null {
  if (days === null) return null;
  const perBucket = { day: 1, week: 7, month: 30, year: 365 }[granularity];
  return Math.ceil(days / perBucket);
}

/**
 * La agrupacion mas fina que sigue siendo legible para un rango dado (~90 marcas como techo).
 *
 * Se usa para el valor por defecto de cada pantalla y para sugerir un cambio, nunca para forzarlo:
 * si el usuario pide 24 meses por dia, se le dan 24 meses por dia con un aviso. Decidir por el es
 * peor que dejarlo elegir mal.
 */
export function suggestedGranularity(range: TimeRangeKey): Granularity {
  const days = RANGE_DAYS[range];
  if (days === null) return "month";
  if (days <= 90) return "day";
  if (days <= 365) return "week";
  return "month";
}

/**
 * Lee el rango de los parametros de la URL.
 *
 * Vive en la URL y no en estado de cliente a proposito: asi las pantallas siguen siendo componentes
 * de servidor (cambiar de "por semana" a "por mes" es navegar a un enlace, no ejecutar JavaScript),
 * el estado sobrevive a un refresco y un enlace a "los ultimos 12 meses por mes" se puede compartir.
 */
export function resolveTimeRange(
  params: Record<string, string | string[] | undefined>,
  defaults: { granularity: Granularity; range: TimeRangeKey },
): TimeRange {
  const range = pick(params.r, TIME_RANGES) ?? defaults.range;
  const granularity = pick(params.g, GRANULARITIES) ?? defaults.granularity;
  return { granularity, range, days: RANGE_DAYS[range] };
}

function pick<T extends readonly string[]>(value: string | string[] | undefined, allowed: T): T[number] | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T[number]) : null;
}

/** Etiqueta de un cubo segun su tamano: "12 mar", "sem. 12 mar", "mar 26", "2026". */
export function formatBucket(date: Date, granularity: Granularity): string {
  switch (granularity) {
    case "day":
      return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    case "week":
      return `sem. ${date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`;
    case "month":
      return date.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
    case "year":
      return date.getUTCFullYear().toString();
  }
}
