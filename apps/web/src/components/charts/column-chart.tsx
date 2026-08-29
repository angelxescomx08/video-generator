import { compactNumber, linearScale, niceTicks, seriesColor } from "./scales";

const WIDTH = 720;
const PADDING = { top: 18, right: 16, bottom: 30, left: 48 };
/** Tope de grosor de barra. Sin el, con pocas columnas cada una se vuelve un bloque enorme. */
const MAX_BAR = 24;
/** Separacion entre columnas vecinas y entre segmentos apilados: aire, no un borde dibujado. */
const GAP = 2;

interface ColumnChartProps {
  labels: string[];
  values: (number | null)[];
  format?: (value: number) => string;
  height?: number;
  minAxisTop?: number;
  colorIndex?: number;
  /** Que representa cada valor, para el texto del hover ("vistas nuevas"). */
  valueLabel?: string;
}

/**
 * Columnas verticales para periodos discretos: lo que paso EN cada semana, mes o ano.
 *
 * La diferencia con la linea no es estetica. Una linea afirma continuidad — que entre dos puntos
 * hubo una transicion gradual — y eso es cierto para un contador acumulado, pero falso para "lo que
 * gane este mes": entre marzo y abril no hay nada intermedio, son dos cantidades separadas. Las
 * columnas dicen exactamente eso, y ademas se comparan de un vistazo por altura.
 *
 * Regla practica: si el dato es acumulado o continuo -> linea. Si es "cuanto hubo en este periodo"
 * -> columnas.
 */
export function ColumnChart({
  labels,
  values,
  format = compactNumber,
  height = 220,
  minAxisTop,
  colorIndex = 0,
  valueLabel = "",
}: ColumnChartProps) {
  const present = values.filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.max(...present, minAxisTop ?? 0, 0));
  const top = ticks[ticks.length - 1] || 1;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const slot = plotWidth / Math.max(labels.length, 1);
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot - GAP));
  const y = linearScale([0, top], [height - PADDING.bottom, PADDING.top]);
  const baseline = y(0);

  const labelStep = Math.max(1, Math.ceil(labels.length / 8));
  // Solo se etiquetan la columna mas alta y la ultima: un numero sobre cada barra no se lee.
  const maxIndex = values.reduce<number>(
    (best, v, i) => (v !== null && (best === -1 || (values[best] ?? 0) < v) ? i : best),
    -1,
  );
  const lastIndex = values.reduce<number>((last, v, i) => (v !== null ? i : last), -1);
  const color = seriesColor(colorIndex);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} role="img" style={{ minWidth: 420 }}>
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
          <text x={PADDING.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
            {format(tick)}
          </text>
        </g>
      ))}

      {values.map((value, i) => {
        const cx = PADDING.left + slot * i + slot / 2;
        if (value === null) {
          return (
            <text key={`gap-${i}`} x={cx} y={baseline - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">
              —
            </text>
          );
        }
        const barHeight = Math.max(0, baseline - y(value));
        return (
          <g key={i}>
            {/* Esquina superior redondeada, base cuadrada: el pie de la barra debe apoyarse en el
                cero, y redondearlo tambien lo despegaria visualmente de la linea base. */}
            <path
              d={roundedTopBar(cx - barWidth / 2, y(value), barWidth, barHeight)}
              fill={color}
            />
            <rect
              x={cx - slot / 2}
              y={PADDING.top}
              width={slot}
              height={height - PADDING.bottom - PADDING.top}
              fill="transparent"
            >
              <title>{`${labels[i] ?? ""}${valueLabel ? ` · ${valueLabel}` : ""}: ${format(value)}`}</title>
            </rect>
            {(i === maxIndex || i === lastIndex) && barHeight > 6 && (
              <text x={cx} y={y(value) - 5} textAnchor="middle" className="fill-foreground text-[10px] font-medium tabular-nums">
                {format(value)}
              </text>
            )}
          </g>
        );
      })}

      <line
        x1={PADDING.left}
        x2={WIDTH - PADDING.right}
        y1={baseline}
        y2={baseline}
        stroke="hsl(var(--border))"
        strokeWidth={1}
      />

      {labels.map((label, i) =>
        i % labelStep === 0 || i === labels.length - 1 ? (
          <text
            key={`${label}-${i}`}
            x={PADDING.left + slot * i + slot / 2}
            y={height - PADDING.bottom + 16}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export interface StackedSeries {
  label: string;
  values: number[];
}

/**
 * Columnas apiladas: cuanto hubo en cada periodo Y de que estaba compuesto.
 *
 * Es la unica forma que responde las dos preguntas a la vez, y por eso vale para el gasto: una
 * curva de "costo total por mes" que baja no dice si fue porque se hicieron menos videos o porque
 * se cambio de voz. El bloque de color que desaparece si lo dice.
 *
 * Maximo cinco series — es la paleta validada completa. Con mas, la respuesta es agrupar la cola en
 * "Otros", no generar un sexto color que bajo daltonismo se confunde con los demas.
 */
export function StackedColumnChart({
  labels,
  series,
  format = compactNumber,
  height = 240,
}: {
  labels: string[];
  series: StackedSeries[];
  format?: (value: number) => string;
  height?: number;
}) {
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] || 1;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const slot = plotWidth / Math.max(labels.length, 1);
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot - GAP));
  const y = linearScale([0, top], [height - PADDING.bottom, PADDING.top]);
  const baseline = y(0);
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} role="img" style={{ minWidth: 420 }}>
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
          <text x={PADDING.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
            {format(tick)}
          </text>
        </g>
      ))}

      {labels.map((label, i) => {
        const cx = PADDING.left + slot * i + slot / 2;
        let cursor = baseline;
        // Cual es el segmento que se apoya en el eje. No es `si === 0`: si la primera serie vale
        // cero en esta columna, el que toca el eje es el siguiente que si tenga valor.
        let isBottom = true;
        return (
          <g key={`${label}-${i}`}>
            {series.map((s, si) => {
              const value = s.values[i] ?? 0;
              if (value <= 0) return null;
              const segmentHeight = baseline - y(value);
              const yTop = cursor - segmentHeight;
              cursor = yTop;
              // El hueco de 2px se descuenta de la ALTURA del segmento, no de su posicion, para que
              // la pila siga sumando el total correcto. El de abajo no lo lleva: ahi el hueco
              // quedaria entre la barra y el eje, y la columna pareceria flotar.
              const drawn = isBottom ? segmentHeight : Math.max(1, segmentHeight - GAP);
              isBottom = false;
              return (
                <rect key={s.label} x={cx - barWidth / 2} y={yTop} width={barWidth} height={drawn} fill={seriesColor(si)}>
                  <title>{`${label} · ${s.label}: ${format(value)}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}

      <line
        x1={PADDING.left}
        x2={WIDTH - PADDING.right}
        y1={baseline}
        y2={baseline}
        stroke="hsl(var(--border))"
        strokeWidth={1}
      />

      {labels.map((label, i) =>
        i % labelStep === 0 || i === labels.length - 1 ? (
          <text
            key={`x-${label}-${i}`}
            x={PADDING.left + slot * i + slot / 2}
            y={height - PADDING.bottom + 16}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Rectangulo con las dos esquinas de arriba redondeadas y las de abajo en angulo recto. */
function roundedTopBar(x: number, yTop: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  const bottom = yTop + height;
  return `M${x},${bottom} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + width - r},${yTop} Q${x + width},${yTop} ${x + width},${yTop + r} L${x + width},${bottom} Z`;
}
