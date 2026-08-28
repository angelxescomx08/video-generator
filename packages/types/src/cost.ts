export const COST_STAGES = ["script", "tts", "stock_footage", "edl", "render"] as const;
export type CostStage = (typeof COST_STAGES)[number];

export const PROVIDER_KINDS = ["ai", "tts", "stock", "render"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** En que se mide el consumo de un proveedor. Es lo que hace comparable "caro" entre modelos: sin
 * esto solo se sabe cuanto se gasto, no si se gasto mucho porque el modelo es caro o porque el
 * guion era largo. */
export const COST_UNIT_KINDS = ["tokens", "chars", "clips", "renders"] as const;
export type CostUnitKind = (typeof COST_UNIT_KINDS)[number];

/** Lo que un proveedor (ai/tts/stock-providers) sabe calcular sobre su propia llamada — no conoce
 * en que etapa del pipeline se esta usando, eso lo agrega el handler que lo invoca. */
export interface ProviderCost {
  providerType: ProviderKind;
  providerName: string;
  /**
   * Modelo/voz concreta que se cobro (`gemini-3.7-flash`, `es-US-Neural2-A`, `nomic-embed-text`).
   *
   * Es una dimension aparte de `providerName` porque el precio vive en el modelo, no en el
   * proveedor: dos videos hechos con Gemini pueden diferir 10x segun si corrieron en flash o en
   * pro, y sin este campo esa diferencia queda invisible en las analiticas de costo.
   */
  model?: string;
  isFree: boolean;
  /** true = corre localmente (Ollama/Piper/Coqui/ffmpeg) -> "Gratis (local)"; false + isFree -> "Gratis". */
  isLocal: boolean;
  amountUsd: number;
  /** Consumo facturable de esta llamada, en las unidades de `unitKind`. */
  units?: number;
  unitKind?: CostUnitKind;
  detail?: string;
}

export interface CostItem extends ProviderCost {
  stage: CostStage;
}
