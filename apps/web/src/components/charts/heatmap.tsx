/**
 * Rampa secuencial de cinco pasos, de menor a mayor magnitud. Un solo tono: el ojo ordena claridad,
 * no matiz — un arcoiris obligaria a consultar la leyenda en cada celda.
 */
const SEQ = ["var(--chart-seq-1)", "var(--chart-seq-2)", "var(--chart-seq-3)", "var(--chart-seq-4)", "var(--chart-seq-5)"];

export interface HeatRow {
  label: string;
  /** Un valor por columna; `null` = sin dato, que se dibuja distinto de un cero. */
  values: (number | null)[];
}

interface HeatmapProps {
  columns: string[];
  rows: HeatRow[];
  format: (value: number) => string;
  /** Techo de la escala de color. Por defecto, el mayor valor presente. */
  maxValue?: number;
  /** Que significa el color, para la leyenda de la escala. */
  scaleLabel: string;
}

/**
 * Mapa de calor: DOS dimensiones categoricas cruzadas, con la magnitud en el color.
 *
 * Se reserva para cuando de verdad hay dos ejes que cruzar (aqui: cada video contra cada tramo de su
 * duracion). Para una sola dimension es la forma equivocada — leer magnitudes en tono es mucho mas
 * impreciso que leerlas en longitud, asi que eso son barras.
 *
 * Lo que hace util este cruce es la lectura por COLUMNA: una columna oscura entera dice que todos
 * los videos pierden audiencia en el mismo punto, y eso ya no es un problema de un guion sino de
 * como se estructuran todos.
 *
 * En HTML y no en SVG porque las etiquetas de fila son titulos de video, que aqui se truncan solos.
 */
export function Heatmap({ columns, rows, format, maxValue, scaleLabel }: HeatmapProps) {
  const present = rows.flatMap((r) => r.values).filter((v): v is number => v !== null);
  const top = maxValue ?? Math.max(...present, 1);

  return (
    <div className="space-y-3">
      <div className="min-w-[420px]">
        <div
          className="grid gap-[2px] text-[10px]"
          style={{ gridTemplateColumns: `minmax(0, 9rem) repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          <span />
          {columns.map((column) => (
            <span key={column} className="pb-1 text-center text-muted-foreground">
              {column}
            </span>
          ))}

          {rows.map((row) => (
            <Row key={row.label} row={row} top={top} format={format} />
          ))}
        </div>
      </div>
      <ScaleLegend top={top} format={format} label={scaleLabel} />
    </div>
  );
}

function Row({ row, top, format }: { row: HeatRow; top: number; format: (value: number) => string }) {
  return (
    <>
      <span className="truncate pr-2 text-muted-foreground" title={row.label}>
        {row.label}
      </span>
      {row.values.map((value, i) => (
        <div
          key={i}
          className="h-6 rounded-[2px]"
          style={{
            background: value === null ? "hsl(var(--muted))" : SEQ[stepOf(value, top)],
          }}
          title={value === null ? `${row.label}: sin dato` : `${row.label}: ${format(value)}`}
        />
      ))}
    </>
  );
}

/**
 * La escala tiene que estar escrita: un mapa de calor sin leyenda solo dice "aqui hay mas que
 * alla", y lo que hace falta saber es cuanto.
 */
function ScaleLegend({ top, format, label }: { top: number; format: (value: number) => string; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{format(0)}</span>
      <span className="flex gap-[2px]">
        {SEQ.map((color) => (
          <span key={color} className="h-2.5 w-6 rounded-[1px]" style={{ background: color }} />
        ))}
      </span>
      <span className="tabular-nums">{format(top)}</span>
    </div>
  );
}

/** A que paso de la rampa cae un valor. Cinco tramos iguales entre 0 y el techo. */
function stepOf(value: number, top: number): number {
  if (top <= 0) return 0;
  const index = Math.floor((value / top) * SEQ.length);
  return Math.max(0, Math.min(SEQ.length - 1, index));
}
