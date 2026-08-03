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
 * Precios USD por 1M tokens (investigados agosto 2026, ver plan de implementacion). Los alias
 * "-latest" de Gemini cambian de modelo/precio con el tiempo sin avisar — si el numero real se
 * desvia mucho, actualizar aqui es el unico lugar que hay que tocar.
 */
const GEMINI_PRICING: Record<string, ModelPrice> = {
  "gemini-flash-latest": { inputPer1M: 1.5, outputPer1M: 7.5 },
  "gemini-2.5-flash": { inputPer1M: 1.5, outputPer1M: 7.5 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
};
const GEMINI_DEFAULT: ModelPrice = { inputPer1M: 1.5, outputPer1M: 7.5 };

const OPENAI_PRICING: Record<string, ModelPrice> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "text-embedding-3-small": { inputPer1M: 0.02, outputPer1M: 0 },
  "text-embedding-3-large": { inputPer1M: 0.13, outputPer1M: 0 },
};
const OPENAI_DEFAULT: ModelPrice = OPENAI_PRICING["gpt-4o-mini"]!;

const ANTHROPIC_PRICING: Record<string, ModelPrice> = {
  "claude-sonnet-4-5": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4 },
};
const ANTHROPIC_DEFAULT: ModelPrice = ANTHROPIC_PRICING["claude-sonnet-4-5"]!;

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
    isFree: false,
    isLocal: false,
    amountUsd,
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

/** Ollama corre local via Docker (OLLAMA_MODEL) — no importa el conteo de tokens, siempre es gratis. */
export function ollamaCost(): ProviderCost {
  return { providerType: "ai", providerName: "ollama", isFree: true, isLocal: true, amountUsd: 0 };
}
