import type { ProviderCost } from "@video-generator/types";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

/**
 * Precios USD por 1M tokens. Revisados y corregidos el 2026-08-23 contra las paginas de precios
 * publicas de cada proveedor.
 *
 * OJO con dos cosas al actualizar:
 *
 * 1. Los alias "-latest" de Gemini cambian de modelo (y de precio) sin avisar. Hoy
 *    `gemini-flash-latest` sirve gemini-3.7-flash, asi que ambas entradas comparten tarifa; si
 *    Google mueve el alias a otro modelo, esta entrada queda desfasada sin que nada falle.
 * 2. Varias tarifas de Gemini son PROMOCIONALES y se duplican el 2027-01-01 (3.6 flash, 3.7 flash,
 *    2.5 flash, 3.1 pro). A partir de esa fecha hay que duplicar esos numeros a mano.
 */
const GEMINI_PRICING: Record<string, ModelPrice> = {
  // Alias que usa este proyecto por defecto -> hoy resuelve a gemini-3.7-flash.
  "gemini-flash-latest": { inputPer1M: 0.75, outputPer1M: 3.75 },
  "gemini-3.7-flash": { inputPer1M: 0.75, outputPer1M: 3.75 },
  "gemini-3.6-flash": { inputPer1M: 0.75, outputPer1M: 3.75 },
  "gemini-3.5-flash": { inputPer1M: 1.5, outputPer1M: 9 },
  "gemini-3-flash": { inputPer1M: 0.5, outputPer1M: 3 },
  "gemini-3-flash-preview": { inputPer1M: 0.25, outputPer1M: 1.5 },
  "gemini-3.1-pro": { inputPer1M: 2, outputPer1M: 12 },
  "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  // Embeddings: tarifa por token de entrada, sin costo de salida.
  "gemini-embedding-001": { inputPer1M: 0.15, outputPer1M: 0 },
  "gemini-embedding-2": { inputPer1M: 0.2, outputPer1M: 0 },
  "text-embedding-004": { inputPer1M: 0.15, outputPer1M: 0 },
};
/** Fallback = tarifa flash vigente. Subestima los modelos Pro, que cuestan bastante mas. */
const GEMINI_DEFAULT: ModelPrice = { inputPer1M: 0.75, outputPer1M: 3.75 };

const OPENAI_PRICING: Record<string, ModelPrice> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  // gpt-4o quedo "grandfathered" en su tarifa vieja tras el lanzamiento de la familia GPT-4.1.
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "text-embedding-3-small": { inputPer1M: 0.02, outputPer1M: 0 },
  "text-embedding-3-large": { inputPer1M: 0.13, outputPer1M: 0 },
};
const OPENAI_DEFAULT: ModelPrice = OPENAI_PRICING["gpt-4o-mini"]!;

const ANTHROPIC_PRICING: Record<string, ModelPrice> = {
  "claude-fable-5": { inputPer1M: 10, outputPer1M: 50 },
  "claude-opus-5": { inputPer1M: 5, outputPer1M: 25 },
  "claude-sonnet-5": { inputPer1M: 2, outputPer1M: 10 },
  "claude-haiku-4-5": { inputPer1M: 1, outputPer1M: 5 },
  "claude-haiku-4-5-20251001": { inputPer1M: 1, outputPer1M: 5 },
  // Generacion anterior, por si alguna config sigue apuntando ahi.
  "claude-sonnet-4-5": { inputPer1M: 3, outputPer1M: 15 },
};
const ANTHROPIC_DEFAULT: ModelPrice = ANTHROPIC_PRICING["claude-sonnet-5"]!;

function costFromTable(
  providerName: string,
  model: string,
  usage: TokenUsage,
  table: Record<string, ModelPrice>,
  fallback: ModelPrice,
): ProviderCost {
  const price = table[model] ?? fallback;
  const amountUsd = (usage.inputTokens / 1_000_000) * price.inputPer1M + (usage.outputTokens / 1_000_000) * price.outputPer1M;
  return {
    providerType: "ai",
    providerName,
    model,
    isFree: false,
    isLocal: false,
    amountUsd,
    units: usage.inputTokens + usage.outputTokens,
    unitKind: "tokens",
    detail: `${usage.inputTokens + usage.outputTokens} tokens (${model})`,
  };
}

export function estimateGeminiCost(model: string, usage: TokenUsage): ProviderCost {
  return costFromTable("gemini", model, usage, GEMINI_PRICING, GEMINI_DEFAULT);
}

export function estimateOpenAiCost(model: string, usage: TokenUsage): ProviderCost {
  return costFromTable("openai", model, usage, OPENAI_PRICING, OPENAI_DEFAULT);
}

export function estimateAnthropicCost(model: string, usage: TokenUsage): ProviderCost {
  return costFromTable("anthropic", model, usage, ANTHROPIC_PRICING, ANTHROPIC_DEFAULT);
}

/**
 * Ollama corre local via Docker (OLLAMA_MODEL) — no importa el conteo de tokens, siempre es gratis.
 *
 * Aun asi lleva `model`: las analiticas de costo comparan modelos entre si, y un modelo local que
 * cuesta $0 es justamente la comparacion que interesa hacer contra uno de pago.
 */
export function ollamaCost(model?: string): ProviderCost {
  return { providerType: "ai", providerName: "ollama", model, isFree: true, isLocal: true, amountUsd: 0 };
}
