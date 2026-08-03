export const COST_STAGES = ["script", "tts", "stock_footage", "edl", "render"] as const;
export type CostStage = (typeof COST_STAGES)[number];

export const PROVIDER_KINDS = ["ai", "tts", "stock", "render"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Lo que un proveedor (ai/tts/stock-providers) sabe calcular sobre su propia llamada — no conoce
 * en que etapa del pipeline se esta usando, eso lo agrega el handler que lo invoca. */
export interface ProviderCost {
  providerType: ProviderKind;
  providerName: string;
  isFree: boolean;
  /** true = corre localmente (Ollama/Piper/Coqui/ffmpeg) -> "Gratis (local)"; false + isFree -> "Gratis". */
  isLocal: boolean;
  amountUsd: number;
  detail?: string;
}

export interface CostItem extends ProviderCost {
  stage: CostStage;
}
