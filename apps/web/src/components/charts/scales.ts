/**
 * Las matematicas de las graficas, aparte del JSX: escalas, ticks y formato.
 *
 * Todo es puro y sin React a proposito — es la parte que conviene poder probar directamente, y la
 * que se equivoca en silencio (un eje mal escalado no falla, solo miente).
 */

/** Los cinco tonos de serie, en el orden validado. Ver la nota en globals.css antes de tocarlos. */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * El color de una serie por su POSICION FIJA, nunca por su rango.
 *
 * Es deliberado que esto reviente conceptualmente pasado el quinto: si una grafica necesita seis
 * series, la respuesta correcta es agrupar la cola en "Otros" o partirla en varias graficas, no
 * generar un sexto color que bajo daltonismo se confunde con alguno de los cinco validados.
 */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

export interface Scale {
  min: number;
  max: number;
  /** Valor -> pixel. */
  (value: number): number;
}

/** Escala lineal a un rango de pixeles. `invert` la usa el eje Y, donde el 0 esta abajo. */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  scale.min = d0;
  scale.max = d1;
  return scale;
}

/**
 * Ticks en numeros redondos (0, 250, 500...) dentro de un dominio.
 *
 * Se calcula el paso a partir de una potencia de 10 y se ajusta a 1/2/5 porque son los unicos
 * multiplos que la gente lee sin pensar; un eje con marcas en 137 y 274 es tecnicamente correcto y
 * practicamente ilegible.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/** El techo del eje: el tick redondo inmediatamente por encima del maximo real. */
export function axisMax(max: number, count = 4): number {
  const ticks = niceTicks(max, count);
  return ticks[ticks.length - 1] || 1;
}

/** 12.9K / 1.2M — para ejes y valores grandes, donde el digito exacto no aporta. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString("es-MX");
}

/**
 * Importes en dolares con la precision que hace falta y ni un decimal mas.
 *
 * Por debajo de $1 hacen falta cuatro decimales (un guion cuesta centesimas de centavo), pero
 * arrastrarlos siempre llena los ejes de ceros muertos — `$0.2000` en una marca de eje es ruido.
 * Se recortan los ceros de la cola solo en ese tramo; a partir de $1 se mantienen los dos decimales
 * de siempre, porque `$9.5` en dinero se lee como un error de formato.
 */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (Math.abs(amount) >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatMxn(amount: number): string {
  return `$${amount.toFixed(2)} MXN`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

export function formatMonth(date: Date): string {
  return date.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

/**
 * Media movil centrada. Es la linea de tendencia de la grafica de "¿estamos mejorando?": los
 * valores por video saltan demasiado para leer una direccion a ojo, y una regresion lineal supondria
 * que la mejora es una recta, cosa que no tiene por que ser cierta.
 *
 * Los extremos promedian con la ventana que alcanzan en vez de quedar en null: con pocos videos,
 * dejar los bordes vacios borraria justo la mitad de la serie.
 */
export function movingAverage(values: (number | null)[], window = 5): (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), i + half + 1).filter((v): v is number => v !== null);
    if (slice.length === 0) return null;
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
}
