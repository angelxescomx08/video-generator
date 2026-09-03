import { loadEnv } from "@video-generator/config";
import { db, providerConfigs, EMBEDDING_DIMENSIONS } from "@video-generator/db";
import { and, eq } from "drizzle-orm";
import { AnthropicProvider } from "./anthropic.provider";
import { GeminiProvider } from "./gemini.provider";
import { OllamaProvider } from "./ollama.provider";
import { OpenAIProvider } from "./openai.provider";
import type { AIProvider } from "./types";

export type AIProviderName = "ollama" | "openai" | "gemini" | "anthropic";

/**
 * `modelOverride` viene de `provider_configs.config.model` (ver /settings/providers): el usuario
 * elige el proveedor Y el modelo ahi, y ese modelo pisa el default del .env sin requerir reinicio
 * del proceso (a diferencia de cambiar OPENAI_MODEL/GEMINI_MODEL/etc en el .env).
 */
function instantiate(name: AIProviderName, modelOverride?: string): AIProvider {
  const env = loadEnv();
  switch (name) {
    case "ollama":
      return new OllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        model: modelOverride ?? env.OLLAMA_MODEL,
        embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
      });
    case "openai":
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
      return new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: modelOverride ?? env.OPENAI_MODEL });
    case "gemini":
      if (!env.GOOGLE_GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY is not set");
      return new GeminiProvider({
        apiKey: env.GOOGLE_GEMINI_API_KEY,
        model: modelOverride ?? env.GEMINI_MODEL,
        embeddingModel: env.GEMINI_EMBEDDING_MODEL,
      });
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
      return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: modelOverride ?? env.ANTHROPIC_MODEL });
  }
}

/** Resolves the AI provider used for script/EDL generation: DB override first, then env var. */
export async function resolveProvider(): Promise<AIProvider> {
  const dbDefault = await db.query.providerConfigs.findFirst({
    where: and(eq(providerConfigs.providerType, "ai"), eq(providerConfigs.isDefault, true), eq(providerConfigs.isEnabled, true)),
  });

  const env = loadEnv();
  const name = (dbDefault?.providerName as AIProviderName | undefined) ?? env.AI_PROVIDER;
  const modelOverride = (dbDefault?.config as { model?: string } | null)?.model;
  return instantiate(name, modelOverride);
}

/**
 * Consulta en vivo los modelos que el proveedor tiene disponibles ahora mismo (ver
 * AIProvider.listModels), para poblar el selector de /settings/providers. No requiere que `name`
 * sea el proveedor por defecto: se puede explorar el catalogo de uno antes de elegirlo.
 */
export async function listModelsForProvider(name: AIProviderName): Promise<string[]> {
  return instantiate(name).listModels();
}

/**
 * Dimension del vector que produce cada proveedor. Tiene que coincidir con la columna
 * `video_memory.embedding` (EMBEDDING_DIMENSIONS), que es de tamano fijo en Postgres.
 *
 * `anthropic` no aparece porque no tiene API de embeddings: seleccionarlo para texto es valido, pero
 * no puede atender los embeddings y hay que caer a otro proveedor.
 */
export const EMBEDDING_PROVIDER_DIMENSIONS: Partial<Record<AIProviderName, number>> = {
  ollama: 768, // nomic-embed-text
  gemini: 768, // text-embedding-004
  openai: 1536, // text-embedding-3-small
};

export function providerSupportsEmbeddings(name: AIProviderName): boolean {
  return EMBEDDING_PROVIDER_DIMENSIONS[name] !== undefined;
}

/**
 * Resuelve el proveedor de embed(), respetando lo que este SELECCIONADO en lugar de mirar solo el
 * .env.
 *
 * Antes esta funcion leia unicamente `env.EMBEDDING_PROVIDER` e ignoraba la base de datos, mientras
 * que resolveProvider() si respetaba la seleccion. Esa asimetria hacia que cambiar el modelo desde
 * /settings/providers moviera los guiones pero dejara los embeddings en otro proveedor, sin que nada
 * lo indicara — el sintoma tipico era un error de Ollama "estando en Gemini".
 *
 * Orden de resolucion:
 *  1. Fila de tipo `embedding` marcada por defecto — el override explicito, para cuando se quiere un
 *     modelo de embeddings distinto al de texto.
 *  2. El proveedor de `ai` seleccionado, si sabe generar embeddings. Es el caso normal: seleccionar
 *     Gemini para todo deberia significar Gemini para todo.
 *  3. `env.EMBEDDING_PROVIDER` como ultimo recurso (p.ej. cuando el de texto es Anthropic).
 */
export async function resolveEmbeddingProvider(): Promise<AIProvider> {
  const env = loadEnv();
  const name = await resolveEmbeddingProviderName(env.EMBEDDING_PROVIDER as AIProviderName);

  // Falla aqui, con un mensaje que dice que hacer, en vez de dejar que pgvector rechace el INSERT
  // con un error de dimensiones que no menciona ni el proveedor ni la variable a cambiar.
  const dimensions = EMBEDDING_PROVIDER_DIMENSIONS[name];
  if (dimensions === undefined) {
    throw new Error(
      `El proveedor de embeddings "${name}" no tiene API de embeddings. Selecciona otro en /settings/providers (tipo "embedding") o ajusta EMBEDDING_PROVIDER.`,
    );
  }
  if (dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `El proveedor de embeddings "${name}" produce vectores de ${dimensions} dimensiones, pero la columna video_memory.embedding es de ${EMBEDDING_DIMENSIONS}. Cambiar de proveedor a uno con otra dimension requiere una migracion de esa columna y re-embeber lo ya guardado (ver packages/db/src/schema/video-memory.ts).`,
    );
  }

  return instantiate(name);
}

async function resolveEmbeddingProviderName(envFallback: AIProviderName): Promise<AIProviderName> {
  const explicit = await db.query.providerConfigs.findFirst({
    where: and(
      eq(providerConfigs.providerType, "embedding"),
      eq(providerConfigs.isDefault, true),
      eq(providerConfigs.isEnabled, true),
    ),
  });
  if (explicit) return explicit.providerName as AIProviderName;

  const textProvider = await db.query.providerConfigs.findFirst({
    where: and(
      eq(providerConfigs.providerType, "ai"),
      eq(providerConfigs.isDefault, true),
      eq(providerConfigs.isEnabled, true),
    ),
  });
  const textName = textProvider?.providerName as AIProviderName | undefined;
  if (textName && providerSupportsEmbeddings(textName)) return textName;

  return envFallback;
}
