import { compactNumber } from "./scales";

/** Los pasos van de mas claro a mas oscuro segun avanzan: es una escala ORDINAL, no categorias. */
const STEP_COLORS = ["var(--chart-seq-2)", "var(--chart-seq-3)", "var(--chart-seq-4)", "var(--chart-seq-5)"];

export interface FunnelStep {
  label: string;
  value: number;
  /** Que significa este paso, en una linea. */
  help: string;
}

/**
 * Embudo: una secuencia donde cada paso es un subconjunto del anterior.
 *
 * Solo vale cuando esa condicion se cumple de verdad — impresiones ⊇ vistas ⊇ vistas con
 * permanencia ⊇ suscriptores — y por eso no es intercambiable con unas barras: lo que se lee no es
 * cada cifra, sino el PORCENTAJE que sobrevive de un paso al siguiente. Ahi es donde se ve si el
 * problema esta en la miniatura (caen las impresiones a vistas) o en el guion (caen las vistas a
 * permanencia), que exigen arreglos completamente distintos.
 *
 * Los pasos con valor cero no se dibujan como un embudo roto: se marcan como "sin dato", porque en
 * Shorts YouTube no reporta impresiones y un cero ahi significa "no lo mide", no "nadie lo vio".
 */
export function Funnel({ steps, format = compactNumber }: { steps: FunnelStep[]; format?: (v: number) => string }) {
  // La referencia del 100% es el primer paso CON dato, no el primero a secas: en Shorts YouTube no
  // reporta impresiones, y anclar el embudo a ese cero dejaba todas las barras siguientes en un
  // hilo de 1px, como si nadie hubiera visto el video.
  const base = steps.find((step) => step.value > 0)?.value ?? 0;

  return (
    <ol className="space-y-2">
      {steps.map((step, i) => {
        const previous = steps[i - 1];
        const share = base > 0 ? (step.value / base) * 100 : 0;
        const conversion = previous && previous.value > 0 ? (step.value / previous.value) * 100 : null;
        const missing = step.value === 0;

        return (
          <li key={step.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium">{step.label}</span>
              <span className="tabular-nums">{missing ? "sin dato" : format(step.value)}</span>
            </div>
            <div className="h-5 w-full rounded-sm bg-muted" title={`${step.label}: ${missing ? "sin dato" : format(step.value)}`}>
              <div
                className="h-5 rounded-sm"
                style={{
                  width: `${missing ? 0 : Math.max(share, 1)}%`,
                  background: STEP_COLORS[Math.min(i, STEP_COLORS.length - 1)],
                }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {conversion !== null && !missing && (
                <span className="font-medium text-foreground">
                  {conversion.toFixed(1)}% de &quot;{previous?.label}&quot;.{" "}
                </span>
              )}
              {step.help}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
