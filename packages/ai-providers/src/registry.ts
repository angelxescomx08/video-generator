import { loadEnv } from "@video-generator/config";
import { db, providerConfigs } from "@video-generator/db";
import { and, eq } from "drizzle-orm";
import { AnthropicProvider } from "./anthropic.provider";
import { GeminiProvider } from "./gemini.provider";
import { OllamaProvider } from "./ollama.provider";
import { OpenAIProvider } from "./openai.provider";
import type { AIProvider } from "./types";

export type AIProviderName = "ollama" | "openai" | "gemini" | "anthropic";

function instantiate(name: AIProviderName): AIProvider {
  const env = loadEnv();
  switch (name) {
    case "ollama":
      return new OllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        model: env.OLLAMA_MODEL,
        embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
      });
    case "openai":
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
      return new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });
    case "gemini":
      if (!env.GOOGLE_GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY is not set");
      return new GeminiProvider({ apiKey: env.GOOGLE_GEMINI_API_KEY, model: env.GEMINI_MODEL });
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
      return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
  }
}

/** Resolves the AI provider used for script/EDL generation: DB override first, then env var. */
export async function resolveProvider(): Promise<AIProvider> {
  const dbDefault = await db.query.providerConfigs.findFirst({
    where: and(eq(providerConfigs.providerType, "ai"), eq(providerConfigs.isDefault, true), eq(providerConfigs.isEnabled, true)),
  });

  const env = loadEnv();
  const name = (dbDefault?.providerName as AIProviderName | undefined) ?? env.AI_PROVIDER;
  return instantiate(name);
}

/** Resolves the provider used only for embed() — independent of the script-generation provider. */
export async function resolveEmbeddingProvider(): Promise<AIProvider> {
  const env = loadEnv();
  return instantiate(env.EMBEDDING_PROVIDER as AIProviderName);
}
