import { compactNumber, linearScale, niceTicks, seriesColor } from "./scales";

const WIDTH = 720;
const PADDING = { top: 18, right: 20, bottom: 42, left: 56 };

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
}

interface ScatterPlotProps {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  height?: number;
  colorIndex?: number;
}

/**
 * Nube de puntos: la forma para cruzar DOS magnitudes continuas y ver si se relacionan.
 *
 * Ninguna otra forma responde "¿gastar mas trae mas vistas?". Una barra por video ordenada por
 * costo sugiere una relacion solo por el orden en que se dibujo; la nube muestra la relacion real,
 * incluida la respuesta incomoda de que no haya ninguna — una mancha sin forma es un resultado
 * valido y muy util: significa que el costo no predice el alcance.
 *
 * Una sola serie, siempre: dos nubes superpuestas se vuelven ilegibles mucho antes que dos lineas.
 */
export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  formatX = compactNumber,
  formatY = compactNumber,
  height = 280,
  colorIndex = 0,
}: ScatterPlotProps) {
  const xTicks = niceTicks(Math.max(...points.map((p) => p.x), 0));
  const yTicks = niceTicks(Math.max(...points.map((p) => p.y), 0));
  const xTop = xTicks[xTicks.length - 1] || 1;
  const yTop = yTicks[yTicks.length - 1] || 1;

  const x = linearScale([0, xTop], [PADDING.left, WIDTH - PADDING.right]);
  const y = linearScale([0, yTop], [height - PADDING.bottom, PADDING.top]);
  const color = seriesColor(colorIndex);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} role="img" style={{ minWidth: 420 }}>
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="hsl(var(--border))"
            strokeWidth={1}
          />
          <text x={PADDING.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
            {formatY(tick)}
          </text>
        </g>
      ))}

      {xTicks.map((tick) => (
        <text
          key={`x-${tick}`}
          x={x(tick)}
          y={height - PADDING.bottom + 15}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] tabular-nums"
        >
          {formatX(tick)}
        </text>
      ))}

      {/* Los nombres de los ejes van escritos: en una nube de puntos, sin ellos no hay forma de
          saber que se esta cruzando con que. */}
      <text x={WIDTH / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
        {xLabel}
      </text>
      <text
        x={-(height - PADDING.bottom + PADDING.top) / 2}
        y={12}
        transform="rotate(-90)"
        textAnchor="middle"
        className="fill-muted-foreground text-[10px]"
      >
        {yLabel}
      </text>

      {points.map((point, i) => (
        <circle
          key={`${point.label}-${i}`}
          cx={x(point.x)}
          cy={y(point.y)}
          r={5}
          fill={color}
          fillOpacity={0.85}
          stroke="hsl(var(--background))"
          strokeWidth={2}
        >
          {/* El anillo del color del fondo separa los puntos que se solapan, que en una nube es la
              norma y no la excepcion. */}
          <title>{`${point.label}\n${xLabel}: ${formatX(point.x)}\n${yLabel}: ${formatY(point.y)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
