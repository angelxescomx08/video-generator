/**
 * Terminos de licencia de cada banco de stock, verificados el 2026-08-23.
 *
 * Esto no es documentacion decorativa: `resolveStockProviders()` filtra por `monetizationSafe`, asi
 * que un proveedor mal clasificado aqui puede meter material que no se puede monetizar en un video
 * publicado. Al agregar un proveedor nuevo hay que leer sus terminos, no asumir.
 */
export interface StockLicense {
  label: string;
  termsUrl: string;
  /** Permite uso comercial, es decir monetizar el video que lo incluye. */
  commercialUse: boolean;
  /**
   * Los terminos EXIGEN credito visible (tipicamente en la descripcion del video).
   * Ojo: para Pexels la licencia de contenido no lo pide, pero los terminos de la API SI.
   */
  attributionRequired: boolean;
  /** Se puede descargar y usar sin comprar una licencia por clip / sin suscripcion de pago. */
  usableWithoutPurchase: boolean;
  notes: string;
}

export const STOCK_LICENSES: Record<string, StockLicense> = {
  pixabay: {
    label: "Pixabay Content License",
    termsUrl: "https://pixabay.com/service/license-summary/",
    commercialUse: true,
    attributionRequired: false,
    usableWithoutPurchase: true,
    notes:
      "Uso comercial libre y sin atribucion obligatoria. El credito es opcional (agradecido, no exigido). " +
      "La licencia trae $0 de indemnizacion: el riesgo por reclamos de terceros lo absorbe quien publica.",
  },
  pexels: {
    label: "Pexels License (via API)",
    termsUrl: "https://www.pexels.com/api/documentation/",
    commercialUse: true,
    // Diferencia clave frente a la descarga manual desde la web: consumir la API obliga a dar credito.
    attributionRequired: true,
    usableWithoutPurchase: true,
    notes:
      "Uso comercial libre, pero los terminos de la API exigen acreditar a Pexels y al autor con un " +
      "enlace visible. Al usarse por API hay que poner las atribuciones en la descripcion del video.",
  },
  shutterstock: {
    label: "Shutterstock (licencia de pago por descarga)",
    termsUrl: "https://www.shutterstock.com/license",
    commercialUse: true,
    attributionRequired: false,
    // Requiere comprar la licencia por clip via su API de licensing; el adaptador no lo implementa.
    usableWithoutPurchase: false,
    notes:
      "Permite uso comercial SOLO despues de comprar la licencia de cada clip. Este adaptador no " +
      "implementa la compra, asi que no puede aportar material utilizable todavia.",
  },
  storyblocks: {
    label: "Storyblocks (suscripcion de pago)",
    termsUrl: "https://www.storyblocks.com/license",
    commercialUse: true,
    attributionRequired: false,
    usableWithoutPurchase: false,
    notes:
      "Uso comercial cubierto por una suscripcion activa de pago. Sin suscripcion vigente el material " +
      "no se puede publicar.",
  },
};

/**
 * Un proveedor es seguro para monetizar si permite uso comercial Y se puede usar sin comprar una
 * licencia aparte. La atribucion obligatoria NO descalifica (Pexels es seguro siempre que se
 * acredite), pero hay que surfacear esos creditos — ver `collectAttributions` en el worker.
 */
export function isMonetizationSafe(providerName: string): boolean {
  const license = STOCK_LICENSES[providerName];
  if (!license) return false;
  return license.commercialUse && license.usableWithoutPurchase;
}

export function requiresAttribution(providerName: string): boolean {
  return STOCK_LICENSES[providerName]?.attributionRequired ?? false;
}
