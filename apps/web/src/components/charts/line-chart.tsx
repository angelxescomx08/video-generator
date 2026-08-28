import { compactNumber, linearScale, niceTicks, seriesColor } from "./scales";

export interface LineSeries {
  label: string;
  /** Un valor por punto del eje X. `null` = sin dato, y corta la linea en vez de dibujar un cero. */
  values: (number | null)[];
  /** Relleno tenue bajo la linea. Solo tiene sentido con una serie: dos rellenos se tapan. */
  area?: boolean;
  /** Puntos sin linea, para una nube de valores por video (la linea seria una mentira de continuidad). */
  dotsOnly?: boolean;
}

interface LineChartProps {
  /** Etiquetas del eje X, una por punto. */
  labels: string[];
  series: LineSeries[];
  /** Como se lee cada valor en el hover y en el eje. */
  format?: (value: number) => string;
  height?: number;
  /**
   * Techo MINIMO del eje Y, no un tope. Con porcentajes se pasa 100 para que una retencion del 40%
   * se lea contra la escala completa y no llene la grafica.
   *
   * Es un minimo y no un maximo porque estas metricas pueden pasar de 100 de verdad: en Shorts, la
   * retencion incluye las repeticiones, asi que un video que se ve en bucle mide 180%. Como tope
   * duro, esa linea se saldria del area de dibujo sin avisar.
   */
  minAxisTop?: number;
}

const WIDTH = 720;
const PADDING = { top: 16, right: 56, bottom: 28, left: 48 };

/**
 * Series a lo largo del tiempo.
 *
 * Un solo eje Y, siempre: dos escalas en un mismo plano inventan una correlacion que no esta en los
 * datos. Cuando hacen falta dos magnitudes distintas (vistas y porcentaje de retencion, por
 * ejemplo) van en dos graficas separadas, no en dos ejes.
 */
export function LineChart({ labels, series, format = compactNumber, height = 240, minAxisTop }: LineChartProps) {
  const allValues = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.max(...allValues, minAxisTop ?? 0, 0));
  // El techo es siempre la ultima marca, no el maximo real: asi la linea superior de la rejilla
  // coincide con un numero redondo en vez de quedar cortada a media altura.
  const top = ticks[ticks.length - 1] || 1;

  const x = linearScale([0, Math.max(labels.length - 1, 1)], [PADDING.left, WIDTH - PADDING.right]);
  const y = linearScale([0, top], [height - PADDING.bottom, PADDING.top]);

  /**
   * Que series se ganan una etiqueta directa en su extremo.
   *
   * Cuando dos lineas terminan juntas, apilar sus etiquetas las despega de su linea y deja de
   * saberse cual es cual. La regla es no dibujarla si otra serie termina a menos de 14px: esa se
   * lee en la leyenda, en el hover y en la tabla, que es exactamente para lo que estan.
   */
  const endYs = series.map((s) => {
    const lastValue = [...s.values].reverse().find((v): v is number => v !== null);
    return lastValue === undefined ? null : y(lastValue);
  });
  const showEndLabel = endYs.map((own, i) =>
    own === null ? false : endYs.every((other, j) => j === i || other === null || Math.abs(other - own) >= 14),
  );

  // Con muchos puntos, etiquetar todos los dias del eje los apelmaza hasta volverlos ilegibles: se
  // reparten ~6 y el resto de los valores los lleva la tabla.
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      width="100%"
      height={height}
      role="img"
      style={{ minWidth: 420 }}
      className="overflow-visible"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="hsl(var(--border))"
            strokeWidth={1}
          />
          <text
            x={PADDING.left - 8}
            y={y(tick) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[10px] tabular-nums"
          >
            {format(tick)}
          </text>
        </g>
      ))}

      {labels.map((label, i) =>
        i % labelStep === 0 || i === labels.length - 1 ? (
          <text
            key={`${label}-${i}`}
            x={x(i)}
            y={height - PADDING.bottom + 16}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {label}
          </text>
        ) : null,
      )}

      {series.map((s, si) => (
        <SeriesMarks
          key={s.label}
          series={s}
          color={seriesColor(si)}
          x={x}
          y={y}
          labels={labels}
          format={format}
          isOnly={series.length === 1}
          showEndLabel={showEndLabel[si] ?? false}
        />
      ))}
    </svg>
  );
}

function SeriesMarks({
  series,
  color,
  x,
  y,
  labels,
  format,
  isOnly,
  showEndLabel,
}: {
  series: LineSeries;
  color: string;
  x: (v: number) => number;
  y: (v: number) => number;
  labels: string[];
  format: (v: number) => string;
  isOnly: boolean;
  showEndLabel: boolean;
}) {
  const points = series.values
    .map((value, i) => (value === null ? null : { i, value, cx: x(i), cy: y(value) }))
    .filter((p): p is { i: number; value: number; cx: number; cy: number } => p !== null);

  if (points.length === 0) return null;

  // Los `null` parten la linea en tramos en vez de saltarlos: unir por encima de un hueco dibujaria
  // una tendencia que no se midio.
  const segments: (typeof points)[] = [];
  let current: typeof points = [];
  for (const [idx, point] of points.entries()) {
    const previous = points[idx - 1];
    if (previous && point.i !== previous.i + 1) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  segments.push(current);

  const last = points[points.length - 1]!;

  return (
    <g>
      {!series.dotsOnly &&
        segments.map((segment, si) => (
          <g key={si}>
            {series.area && segment.length > 1 && (
              <path
                d={`${segment.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx},${p.cy}`).join(" ")} L${segment[segment.length - 1]!.cx},${y(0)} L${segment[0]!.cx},${y(0)} Z`}
                fill={color}
                opacity={0.1}
              />
            )}
            <path
              d={segment.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx},${p.cy}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

      {/* El anillo del color del fondo mantiene legible el punto donde dos series se cruzan. */}
      {(series.dotsOnly || points.length <= 40) &&
        points.map((p) => (
          <circle
            key={p.i}
            cx={p.cx}
            cy={p.cy}
            r={4}
            fill={color}
            stroke="hsl(var(--background))"
            strokeWidth={2}
          />
        ))}

      {/* Blanco de golpeo: el punto visible mide 8px, muy poco para apuntarle. Este circulo
          transparente de 20px es el que recibe el raton y muestra el valor. */}
      {points.map((p) => (
        <circle key={`hit-${p.i}`} cx={p.cx} cy={p.cy} r={10} fill="transparent">
          <title>{`${labels[p.i] ?? ""} · ${series.label}: ${format(p.value)}`}</title>
        </circle>
      ))}

      {/* Etiqueta directa solo en el extremo, y solo cuando hay sitio: un numero por punto no se lee. */}
      {showEndLabel && (
        <text
          x={last.cx + 8}
          y={last.cy + 4}
          className={
            isOnly
              ? "fill-foreground text-[11px] font-medium tabular-nums"
              : "fill-muted-foreground text-[10px] tabular-nums"
          }
        >
          {format(last.value)}
        </text>
      )}
    </g>
  );
}
