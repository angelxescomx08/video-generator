import { EMBEDDING_DIMENSIONS } from "@video-generator/db";
import { editDecisionListSchema, type EditDecisionList, type ProviderCost } from "@video-generator/types";
import { estimateGeminiCost } from "./pricing";
import { geminiCharBudget, truncateForEmbedding } from "./embedding-input";
import { buildScriptUserPrompt } from "./script-context";
import { MUSIC_SUGGESTION_INSTRUCTION, VISUAL_KEYWORDS_INSTRUCTION } from "./types";
import type {
  AICallResult,
  AIProvider,
  EDLGenerationRequest,
  EmbeddingRequest,
  ScriptGenerationRequest,
  ScriptGenerationResult,
} from "./types";

interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  embeddingModel: string;
}

/** Devuelve el vector con norma 1, para que las metricas de distancia se comporten como esperan. */
function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((total, v) => total + v * v, 0));
  return magnitude === 0 ? values : values.map((v) => v / magnitude);
}

/**
 * responseSchema para forzar salida estructurada valida (evita JSON malformado como strings sin
 * comillas). Usa el formato de esquema de Gemini (tipos en MAYUSCULAS). Espeja ScriptGenerationResult.
 */
const SCRIPT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    description: { type: "STRING" },
    script: { type: "STRING" },
    scenes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          narrationText: { type: "STRING" },
          estimatedDurationSeconds: { type: "NUMBER" },
          visualKeywords: { type: "ARRAY", items: { type: "STRING" } },
          captionText: { type: "STRING" },
        },
        required: ["index", "narrationText", "estimatedDurationSeconds", "visualKeywords"],
      },
    },
    tags: { type: "ARRAY", items: { type: "STRING" } },
    extractedFacts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          factType: { type: "STRING" },
          factValue: { type: "STRING" },
        },
        required: ["factType", "factValue"],
      },
    },
  },
  required: ["title", "description", "script", "scenes", "tags", "extractedFacts"],
} as const;

/** Quita fences markdown (```json ... ```) que a veces envuelven la respuesta antes de parsear. */
function parseJsonLenient(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned);
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gemini responde 503 "UNAVAILABLE" con frecuencia por sobrecarga del modelo, no por un error
 * del request. Reintenta con backoff exponencial + jitter antes de rendirse.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, init);
    if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES) {
      return response;
    }
    const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
    await sleep(delay);
  }
  throw new Error("unreachable");
}

/** Ready to activate via AI_PROVIDER=gemini + GOOGLE_GEMINI_API_KEY. */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  get embeddingCharBudget(): number {
    return geminiCharBudget(this.options.embeddingModel);
  }

  constructor(private readonly options: GeminiProviderOptions) {}

  private async generateJson(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: unknown,
  ): Promise<{ json: unknown; cost: ProviderCost }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.options.model}:generateContent?key=${this.options.apiKey}`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          ...(responseSchema ? { responseSchema } : {}),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(`Gemini returned no content: ${JSON.stringify(data)}`);
    }
    const cost = estimateGeminiCost(this.options.model, {
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    });
    return { json: parseJsonLenient(text), cost };
  }

  async generateScript(req: ScriptGenerationRequest): Promise<AICallResult<ScriptGenerationResult>> {
    const userPrompt = buildScriptUserPrompt(
      req,
      `Devuelve JSON con title, description, script, scenes[], tags[], extractedFacts[]. ${VISUAL_KEYWORDS_INSTRUCTION}`,
    );
    const { json, cost } = await this.generateJson(req.systemPrompt, userPrompt, SCRIPT_RESPONSE_SCHEMA);
    return { result: json as ScriptGenerationResult, cost };
  }

  async generateEDL(req: EDLGenerationRequest): Promise<AICallResult<EditDecisionList>> {
    const userPrompt = `Genera una Edit Decision List JSON para estas escenas: ${JSON.stringify(req.scenes)}, formato ${req.format}, clips: ${JSON.stringify(req.availableClips)}.\n\n${MUSIC_SUGGESTION_INSTRUCTION}`;
    const { json, cost } = await this.generateJson("Eres un editor de video experto.", userPrompt);
    const parsed = editDecisionListSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Gemini returned an invalid EDL: ${parsed.error.message}`);
    }
    return { result: parsed.data, cost };
  }

  /**
   * Los modelos de embeddings de Gemini devuelven 3072 dimensiones por defecto, pero son embeddings
   * Matryoshka: se les puede pedir un tamano menor con `outputDimensionality`. Se piden
   * EMBEDDING_DIMENSIONS (768) para que el vector entre en la columna `video_memory.embedding` tal
   * como esta, sin migrarla.
   *
   * Un embedding Matryoshka recortado deja de tener norma 1, asi que se re-normaliza. Con distancia
   * coseno da igual (es invariante a la escala) y es la unica que usa el proyecto hoy, pero las demas
   * metricas de pgvector si esperan un vector normalizado.
   *
   * `text-embedding-004` quedo RETIRADO y responde 404; el modelo vigente sale de
   * GEMINI_EMBEDDING_MODEL.
   */
  async embed(req: EmbeddingRequest): Promise<AICallResult<number[]>> {
    const model = this.options.embeddingModel;
    const text = truncateForEmbedding(req.text, geminiCharBudget(model));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${this.options.apiKey}`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini embeddings request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { embedding: { values: number[] } };
    const values = normalizeVector(data.embedding.values);
    if (values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Gemini devolvio ${values.length} dimensiones pero la columna espera ${EMBEDDING_DIMENSIONS}. Revisa GEMINI_EMBEDDING_MODEL.`,
      );
    }

    // El endpoint :embedContent no regresa usageMetadata; se aproxima 1 token ~ 4 caracteres.
    const cost = estimateGeminiCost(model, {
      // Se cobra por lo que se ENVIO, no por el texto original: si se recorto, el resto nunca viajo.
      inputTokens: Math.ceil(text.length / 4),
      outputTokens: 0,
    });
    return { result: values, cost };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.options.apiKey}`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
