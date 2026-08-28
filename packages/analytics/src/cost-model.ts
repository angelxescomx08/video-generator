import type { CostItem, CostUnitKind, ProviderCost } from "@video-generator/types";

/**
 * Como leer el modelo de un costo ya guardado. Funciones puras, sin I/O — testeables directamente.
 */

/**
 * El modelo con el que se cobro este item.
 *
 * `model` es un campo relativamente nuevo: las versiones renderizadas antes de que existiera lo
 * llevan solo dentro de `detail`, con la forma `"1234 tokens (gemini-3.7-flash)"`. Rescatarlo de
 * ahi es lo que evita que media grafica de "costo por modelo" salga como "sin especificar" en un
 * canal con historia. Cuando no hay ninguna de las dos cosas, el nombre del proveedor es la
 * etiqueta mas honesta que queda.
 */
export function costItemModel(item: ProviderCost): string {
  if (item.model) return item.model;
  const fromDetail = item.detail?.match(/\(([^)]+)\)\s*$/)?.[1]?.trim();
  return fromDetail && fromDetail.length > 0 ? fromDetail : item.providerName;
}

/** Etiqueta legible del modelo, con el proveedor delante cuando el nombre por si solo no lo dice. */
export function costItemLabel(item: ProviderCost): string {
  const model = costItemModel(item);
  return model === item.providerName ? model : `${item.providerName} · ${model}`;
}

export const UNIT_LABELS: Record<CostUnitKind, { singular: string; plural: string; per: string }> = {
  tokens: { singular: "token", plural: "tokens", per: "por 1M tokens" },
  chars: { singular: "caracter", plural: "caracteres", per: "por 1M caracteres" },
  clips: { singular: "clip", plural: "clips", per: "por clip" },
  renders: { singular: "render", plural: "renders", per: "por render" },
};

/**
 * Precio efectivo por millon de unidades. Es la unica cifra que compara modelos de forma justa: un
 * modelo puede aparecer como el mas caro del canal solo porque se uso en los guiones mas largos.
 *
 * Devuelve null cuando no hay consumo medido — mejor no mostrar nada que dividir entre cero y
 * publicar un infinito.
 */
export function effectiveUnitPrice(usd: number, units: number, unitKind: CostUnitKind | null): number | null {
  if (units <= 0) return null;
  if (unitKind === "clips" || unitKind === "renders") return usd / units;
  return (usd / units) * 1_000_000;
}

/** Suma de un desglose, tolerante a versiones sin desglose guardado. */
export function totalUsd(items: CostItem[] | null | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + item.amountUsd, 0);
}
