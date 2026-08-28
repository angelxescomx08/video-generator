import { seriesColor } from "./scales";

export interface BarRow {
  label: string;
  value: number;
  /** Texto secundario bajo la etiqueta (muestra, unidades, precio unitario...). */
  note?: string;
  /** Lo que se escribe en la punta de la barra. Por defecto, el valor formateado. */
  display?: string;
}

interface BarChartProps {
  rows: BarRow[];
  format?: (value: number) => string;
  /**
   * Techo MINIMO de la escala, no un tope. Sin el, la barra mas grande siempre llena el ancho
   * completo, lo que hace parecer excelente a un 12% de retencion solo por ser el mejor del lote;
   * pasando 100 se compara contra la escala real. Si un valor lo supera (la retencion de un Short
   * en bucle pasa de 100 de verdad), manda el valor, para que ninguna barra se salga del carril.
   */
  minAxisTop?: number;
  /** Indice de color de serie. Todas las barras comparten uno: son categorias, no una magnitud. */
  colorIndex?: number;
}

/**
 * Barras horizontales para comparar categorias nominales (modelos, fuentes de trafico, videos).
 *
 * Horizontales y en HTML en vez de SVG porque las etiquetas son titulos de video y nombres de
 * modelo: en HTML se truncan y se envuelven solas, mientras que en SVG habria que medir el texto a
 * mano para que no se desborde.
 *
 * TODAS las barras llevan el mismo color. Teñirlas mas oscuras cuanto mas grandes duplicaria en el
 * tono la informacion que ya da el largo, y gastaria el unico canal libre que queda.
 */
export function BarChart({ rows, format = (v) => v.toLocaleString("es-MX"), minAxisTop, colorIndex = 0 }: BarChartProps) {
  const top = Math.max(...rows.map((r) => Math.abs(r.value)), minAxisTop ?? 0, 0);
  const color = seriesColor(colorIndex);

  return (
    <ul className="space-y-2.5">
      {rows.map((row, i) => (
        <li key={`${row.label}-${i}`} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs" title={row.label}>
              {row.label}
            </p>
            {row.note && <p className="truncate text-[10px] text-muted-foreground">{row.note}</p>}
          </div>
          <div className="h-3 min-w-0 rounded-sm bg-muted" title={`${row.label}: ${row.display ?? format(row.value)}`}>
            <div
              className="h-3 rounded-r-[4px]"
              style={{ width: `${top > 0 ? Math.max((Math.abs(row.value) / top) * 100, row.value === 0 ? 0 : 1.5) : 0}%`, background: color }}
            />
          </div>
          <span className="text-xs tabular-nums">{row.display ?? format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface CompositionSegment {
  label: string;
  value: number;
}

/**
 * Una sola barra apilada: la composicion de un total (en que etapa se fue el dinero).
 *
 * Es la forma correcta para parte-de-un-todo con pocos segmentos, y sustituye a un pastel: comparar
 * dos porciones parecidas en angulos es mucho mas dificil que en longitudes.
 *
 * Los segmentos se separan con 2px del color del fondo, no con un borde: un borde alrededor de cada
 * bloque agrega tinta que no es dato y ensucia la lectura.
 */
export function CompositionBar({
  segments,
  format,
}: {
  segments: CompositionSegment[];
  format: (value: number) => string;
}) {
  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0 || visible.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full gap-[2px] overflow-hidden">
        {visible.map((segment, i) => (
          <div
            key={segment.label}
            className="h-4 first:rounded-l-[4px] last:rounded-r-[4px]"
            style={{ width: `${(segment.value / total) * 100}%`, background: seriesColor(i) }}
            title={`${segment.label}: ${format(segment.value)} (${((segment.value / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {visible.map((segment, i) => (
          <li key={segment.label} className="flex items-center gap-2 text-xs">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seriesColor(i) }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{segment.label}</span>
            <span className="tabular-nums">{format(segment.value)}</span>
            <span className="w-12 text-right tabular-nums text-muted-foreground">
              {((segment.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
