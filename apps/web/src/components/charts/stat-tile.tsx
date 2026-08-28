import type { ReactNode } from "react";

/**
 * Cuando la historia es un numero, la forma correcta NO es una grafica.
 *
 * Un total del canal o el costo medio por video no ganan nada dibujados: una barra sola no compara
 * con nada. Estas dos piezas son la respuesta a ese caso.
 */

interface StatTileProps {
  label: string;
  value: string;
  /** Contexto que hace legible el numero: el promedio del canal, la muestra, la unidad. */
  hint?: ReactNode;
  /**
   * Diferencia contra una referencia. `direction` dice si subir es bueno, porque no siempre lo es
   * (mas retencion, si; mas costo por video, no).
   */
  delta?: { points: number; label: string; upIsGood?: boolean };
}

export function StatTile({ label, value, hint, delta }: StatTileProps) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
      {delta && <DeltaLine {...delta} />}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * El signo y la palabra van juntos siempre. Un delta que solo se distingue por el color es
 * ilegible para quien no separa rojo de verde, y ademas se pierde por completo al imprimir.
 */
function DeltaLine({ points, label, upIsGood = true }: { points: number; label: string; upIsGood?: boolean }) {
  const rounded = Math.round(points * 10) / 10;
  if (rounded === 0) return <p className="mt-1 text-[11px] text-muted-foreground">igual que {label}</p>;

  const isGood = rounded > 0 === upIsGood;
  const sign = rounded > 0 ? "+" : "";
  return (
    <p className={`mt-1 text-[11px] font-medium ${isGood ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
      {sign}
      {rounded} {isGood ? "por encima de" : "por debajo de"} {label}
    </p>
  );
}

/**
 * El numero con el que abre una pantalla. Uno solo por vista: dos numeros gigantes no jerarquizan
 * nada. Cifras proporcionales (no `tabular-nums`), que a este tamano se ven apretadas de otro modo.
 */
export function HeroNumber({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-5xl font-semibold leading-none">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
