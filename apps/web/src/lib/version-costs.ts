import { COST_STAGES, type CostItem, type CostStage } from "@video-generator/types";

export const STAGE_LABELS: Record<CostStage, string> = {
  script: "Guion (IA)",
  tts: "Voz (TTS)",
  stock_footage: "Video (stock)",
  edl: "Edicion (IA)",
  render: "Render",
};

export interface VersionLike {
  id: string;
  versionNumber: number;
  costBreakdown: CostItem[] | null;
  costTotalUsd: string | null;
  costTotalMxn: string | null;
  exchangeRateUsed: string | null;
}

export interface VersionCostSummary {
  versionId: string;
  versionNumber: number;
  /** Lo que costo GENERAR esta version (solo las etapas que realmente se volvieron a correr). */
  newCostUsd: number;
  newCostMxn: number;
  /** Etapas que se pagaron en esta version. */
  paidStages: CostStage[];
  /** Etapas heredadas de una version anterior, que no se volvieron a pagar. */
  reusedStages: CostStage[];
  /** Lo que habria costado repetir esas etapas reutilizadas — el ahorro de esta version. */
  savedUsd: number;
  savedMxn: number;
  /** Costo acumulado de produccion hasta esta version inclusive. */
  cumulativeUsd: number;
  cumulativeMxn: number;
  items: CostItem[];
}

function rateOf(version: VersionLike, fallback: number): number {
  const parsed = Number(version.exchangeRateUsed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Calcula, por version, cuanto costo generarla y cuanto se ahorro reutilizando material.
 *
 * El modelo de costos del worker ya es INCREMENTAL: `attributeCostsToVersion` solo le asigna a cada
 * version los jobs que todavia no estaban atados a ninguna, asi que el `costBreakdown` de una
 * version contiene unicamente las etapas que de verdad se volvieron a correr. Por eso un cambio de
 * musica (que solo re-renderiza) aparece con el costo del render y nada mas.
 *
 * De ahi sale el ahorro: las etapas que NO estan en esta version pero si se pagaron antes son
 * material reutilizado, y su costo previo es lo que se dejo de gastar. Ese es el valor de poder
 * cambiar la cancion sin regenerar guion ni voz.
 *
 * Funcion pura, sin I/O — testeable directamente.
 */
export function summarizeVersionCosts(
  versions: VersionLike[],
  fallbackRate: number,
): { perVersion: VersionCostSummary[]; totalUsd: number; totalMxn: number; totalSavedUsd: number } {
  const ascending = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);

  /** Ultimo costo conocido de cada etapa, para valorar lo que se reutiliza mas adelante. */
  const lastCostByStage = new Map<CostStage, number>();
  const perVersion: VersionCostSummary[] = [];
  let cumulativeUsd = 0;
  let cumulativeMxn = 0;
  let totalSavedUsd = 0;

  for (const version of ascending) {
    const items = version.costBreakdown ?? [];
    const rate = rateOf(version, fallbackRate);

    const paidStages = COST_STAGES.filter((stage) => items.some((i) => i.stage === stage));
    const newCostUsd = items.reduce((sum, i) => sum + i.amountUsd, 0);

    const reusedStages = [...lastCostByStage.keys()].filter((stage) => !paidStages.includes(stage));
    const savedUsd = reusedStages.reduce((sum, stage) => sum + (lastCostByStage.get(stage) ?? 0), 0);

    cumulativeUsd += newCostUsd;
    cumulativeMxn += newCostUsd * rate;
    totalSavedUsd += savedUsd;

    perVersion.push({
      versionId: version.id,
      versionNumber: version.versionNumber,
      newCostUsd,
      newCostMxn: newCostUsd * rate,
      paidStages,
      // Orden estable segun el pipeline, no segun el orden de insercion en el Map.
      reusedStages: COST_STAGES.filter((s) => reusedStages.includes(s)),
      savedUsd,
      savedMxn: savedUsd * rate,
      cumulativeUsd,
      cumulativeMxn,
      items,
    });

    for (const stage of paidStages) {
      const stageCost = items.filter((i) => i.stage === stage).reduce((sum, i) => sum + i.amountUsd, 0);
      lastCostByStage.set(stage, stageCost);
    }
  }

  return {
    // Mas reciente primero, que es como se listan en la UI.
    perVersion: perVersion.reverse(),
    totalUsd: cumulativeUsd,
    totalMxn: cumulativeMxn,
    totalSavedUsd,
  };
}

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  return `$${amount.toFixed(amount < 1 ? 4 : 2)}`;
}

export function formatMxn(amount: number): string {
  return `$${amount.toFixed(2)} MXN`;
}
