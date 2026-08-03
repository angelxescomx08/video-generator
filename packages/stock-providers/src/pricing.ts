import type { ProviderCost } from "@video-generator/types";

/** Pixabay/Pexels son gratis para uso comercial, sin costo por clip. */
export function freeStockCost(providerName: string): ProviderCost {
  return { providerType: "stock", providerName, isFree: true, isLocal: false, amountUsd: 0 };
}

/**
 * Shutterstock/Storyblocks no publican precio por descarga via API (requiere cotizacion con
 * ventas para uso en produccion) — y su download() en este repo todavia lanza NotImplementedError.
 * En vez de inventar un numero, se deja en $0 con el detalle explicado.
 */
export function unpricedPremiumStockCost(providerName: string): ProviderCost {
  return {
    providerType: "stock",
    providerName,
    isFree: false,
    isLocal: false,
    amountUsd: 0,
    detail: "Sin precio publico por API (requiere cotizacion) — descarga aun no implementada en este adaptador",
  };
}
