import {
  editDecisionListSchema,
  YOUTUBE_AUDIO_GENRES,
  YOUTUBE_AUDIO_MOODS,
  type EditDecisionList,
  type ProviderCost,
} from "@video-generator/types";
import { estimateOpenAiCost } from "./pricing";
import { parseScriptResult } from "./script-result";
import { EMBEDDING_CHAR_BUDGETS, truncateForEmbedding } from "./embedding-input";
import { buildScriptUserPrompt } from "./script-context";
import { buildDimensionClassificationPrompt, buildDimensionProposalPrompt, buildTopicProposalPrompt, type ProposedTopic, type TopicProposalRequest, MUSIC_SUGGESTION_INSTRUCTION, SCENE_EFFECT_INSTRUCTION, VISUAL_KEYWORDS_INSTRUCTION } from "./types";
import type {
  AICallResult,
  AIProvider,
  DimensionClassificationRequest,
  DimensionProposalRequest,
  EDLGenerationRequest,
  EmbeddingRequest,
  ProposedDimension,
  ScriptGenerationRequest,
  ScriptGenerationResult,
} from "./types";

interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  embeddingModel?: string;
}

/** Un esquema listo para mandar como `response_format: { type: "json_schema" }`. */
interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

/**
 * Structured Outputs (`response_format: json_schema` con `strict: true`) es el analogo exacto de
 * `responseSchema` de Gemini, y hace falta por la misma razon documentada en CLAUDE.md:
 * `response_format: { type: "json_object" }` garantiza JSON, NO garantiza JSON con la forma que el
 * proyecto espera. Sin esto, `editDecisionListSchema.safeParse` rechazaba la respuesta y el video
 * se montaba con el fallback determinista (mismo efecto en todas las escenas, sin musica) pagando
 * igual la llamada.
 *
 * Dos reglas del modo `strict` moldean todos los esquemas de abajo:
 *  1. Todo objeto lleva `additionalProperties: false`.
 *  2. TODA propiedad declarada tiene que estar en `required` — lo opcional se expresa como nullable
 *     (`type: ["string", "null"]`) y lo desarma `stripNulls` antes de validar.
 *
 * Solo se piden los campos que son decision del modelo: tiempos, clips, rutas y estilo de
 * subtitulos los sobreescribe el worker despues y tienen default en el schema de zod, asi que
 * pedirlos solo agrandaria la superficie donde la respuesta puede fallar.
 */
const SCRIPT_JSON_SCHEMA: JsonSchemaSpec = {
  name: "script_generation",
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      script: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            narrationText: { type: "string" },
            estimatedDurationSeconds: { type: "number" },
            visualKeywords: { type: "array", items: { type: "string" } },
            captionText: { type: ["string", "null"] },
          },
          required: ["index", "narrationText", "estimatedDurationSeconds", "visualKeywords", "captionText"],
          additionalProperties: false,
        },
      },
      tags: { type: "array", items: { type: "string" } },
      extractedFacts: {
        type: "array",
        items: {
          type: "object",
          properties: { factType: { type: "string" }, factValue: { type: "string" } },
          required: ["factType", "factValue"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "description", "script", "scenes", "tags", "extractedFacts"],
    additionalProperties: false,
  },
};

/**
 * Los parametros de cada efecto van como objeto plano con todo nullable en vez de `anyOf`: es la
 * misma decision que en gemini.provider.ts, porque `sceneEffectSchema` de zod narra por `type` y
 * descarta los campos que sobren (un `intensity` colado en un ken_burns se ignora, no rompe).
 *
 * `youtubeAudioLibrary` si usa los enums reales de la Biblioteca de audio de YouTube: aqui el
 * esquema puede garantizar valores validos en vez de dejar que el worker descarte los inventados.
 */
const EDL_JSON_SCHEMA: JsonSchemaSpec = {
  name: "edit_decision_list",
  schema: {
    type: "object",
    properties: {
      version: { type: "integer", enum: [1] },
      format: { type: "string", enum: ["long", "short"] },
      totalDurationSeconds: { type: "number" },
      audio: {
        type: "object",
        properties: {
          musicSuggestionTags: { type: "array", items: { type: "string" } },
          youtubeAudioLibrary: {
            type: "object",
            properties: {
              genres: { type: "array", items: { type: "string", enum: [...YOUTUBE_AUDIO_GENRES] } },
              moods: { type: "array", items: { type: "string", enum: [...YOUTUBE_AUDIO_MOODS] } },
            },
            required: ["genres", "moods"],
            additionalProperties: false,
          },
        },
        required: ["musicSuggestionTags", "youtubeAudioLibrary"],
        additionalProperties: false,
      },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            durationSeconds: { type: "number" },
            effect: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["none", "ken_burns", "zoom_punch"] },
                direction: { type: ["string", "null"], enum: ["in", "out", null] },
                panX: { type: ["string", "null"], enum: ["left", "right", "center", null] },
                panY: { type: ["string", "null"], enum: ["up", "down", "center", null] },
                intensity: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
              },
              required: ["type", "direction", "panX", "panY", "intensity"],
              additionalProperties: false,
            },
            transitionOut: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["cut", "crossfade", "fade_black"] },
                durationSeconds: { type: ["number", "null"] },
              },
              required: ["type", "durationSeconds"],
              additionalProperties: false,
            },
          },
          required: ["index", "durationSeconds", "effect", "transitionOut"],
          additionalProperties: false,
        },
      },
    },
    required: ["version", "format", "totalDurationSeconds", "audio", "scenes"],
    additionalProperties: false,
  },
};

const DIMENSION_PROPOSAL_JSON_SCHEMA: JsonSchemaSpec = {
  name: "dimension_proposals",
  schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            question: { type: "string" },
            buckets: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
          },
          required: ["label", "question", "buckets", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["proposals"],
    additionalProperties: false,
  },
};


const TOPIC_PROPOSAL_JSON_SCHEMA: JsonSchemaSpec = {
  name: "topic_proposals",
  schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            idea: { type: "string" },
            angle: { type: "string" },
            sourceUrls: { type: "array", items: { type: "string" } },
          },
          required: ["title", "idea", "angle", "sourceUrls"],
          additionalProperties: false,
        },
      },
    },
    required: ["proposals"],
    additionalProperties: false,
  },
};

/**
 * Quita las claves con valor null, recursivamente.
 *
 * Traduce entre dos convenciones de "opcional" que no se hablan: el modo `strict` de Structured
 * Outputs exige TODO campo en `required` (asi que lo opcional se pide nullable), mientras que los
 * esquemas de zod del proyecto usan `.optional()`/`.default()`, que aceptan la clave AUSENTE pero
 * rechazan null. Sin esta traduccion un `panX: null` perfectamente valido para la API tumbaba el
 * EDL completo al fallback.
 */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, stripNulls(v)]),
    );
  }
  return value;
}

/**
 * Full OpenAI Chat Completions (JSON mode) implementation. Ready to activate by setting
 * AI_PROVIDER=openai and OPENAI_API_KEY — no other code changes needed (see registry.ts).
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly embeddingCharBudget = EMBEDDING_CHAR_BUDGETS.openai;

  constructor(private readonly options: OpenAIProviderOptions) {}

  private postChat(body: Record<string, unknown>): Promise<Response> {
    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  private async chatJson(
    systemPrompt: string,
    userPrompt: string,
    jsonSchema?: JsonSchemaSpec,
  ): Promise<{ json: unknown; cost: ProviderCost }> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    let response = await this.postChat({
      model: this.options.model,
      messages,
      response_format: jsonSchema
        ? { type: "json_schema", json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: true } }
        : { type: "json_object" },
    });

    /**
     * Un modelo sin soporte de Structured Outputs rechaza `response_format: json_schema` con 400. En
     * vez de dejar la generacion muerta, se reintenta en JSON mode simple: la forma deja de estar
     * garantizada por la API, pero el `safeParse` de cada metodo sigue atajando lo que no encaje.
     * Es lo que hace que el provider sirva con CUALQUIER modelo del selector, no solo los recientes.
     *
     * Se filtra por el texto del error a proposito: un 400 por prompt invalido o cuota no se debe
     * reintentar, y reintentar a ciegas convertiria cualquier error en dos llamadas cobradas.
     */
    if (response.status === 400 && jsonSchema) {
      const detail = await response.text();
      if (!/response_format|json_schema|structured output/i.test(detail)) {
        throw new Error(`OpenAI request failed: 400 ${detail}`);
      }
      response = await this.postChat({
        model: this.options.model,
        messages,
        response_format: { type: "json_object" },
      });
    }

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string | null; refusal?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const cost = estimateOpenAiCost(this.options.model, {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    });

    // Con Structured Outputs el modelo puede negarse; ahi `content` viene null y el motivo en
    // `refusal`. Sin este caso, JSON.parse(null) reventaba con un error que no decia nada.
    const message = data.choices[0]?.message;
    if (!message?.content) {
      throw new Error(`OpenAI returned no content${message?.refusal ? `: ${message.refusal}` : ""}`);
    }

    return { json: stripNulls(JSON.parse(message.content)), cost };
  }

  async generateScript(req: ScriptGenerationRequest): Promise<AICallResult<ScriptGenerationResult>> {
    const userPrompt = buildScriptUserPrompt(
      req,
      `Devuelve JSON con: title, description, script, scenes[], tags[], extractedFacts[]. ${VISUAL_KEYWORDS_INSTRUCTION}`,
    );
    const { json, cost } = await this.chatJson(req.systemPrompt, userPrompt, SCRIPT_JSON_SCHEMA);
    return { result: parseScriptResult(this.name, json), cost };
  }

  async generateEDL(req: EDLGenerationRequest): Promise<AICallResult<EditDecisionList>> {
    const userPrompt = `Genera una Edit Decision List (JSON) para ${req.scenes.length} escenas, formato ${req.format}. Escenas: ${JSON.stringify(req.scenes)}. Clips disponibles: ${JSON.stringify(req.availableClips)}.\n\n${SCENE_EFFECT_INSTRUCTION}\n\n${MUSIC_SUGGESTION_INSTRUCTION}`;
    const { json, cost } = await this.chatJson("Eres un editor de video experto.", userPrompt, EDL_JSON_SCHEMA);
    const parsed = editDecisionListSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`OpenAI returned an invalid EDL: ${parsed.error.message}`);
    }
    return { result: parsed.data, cost };
  }

  async proposeDimensions(req: DimensionProposalRequest): Promise<AICallResult<ProposedDimension[]>> {
    const { json, cost } = await this.chatJson(
      "Eres un analista de contenido que busca patrones en guiones de video. Propones hipotesis, no conclusiones.",
      buildDimensionProposalPrompt(req),
      DIMENSION_PROPOSAL_JSON_SCHEMA,
    );
    return { result: (json as { proposals?: ProposedDimension[] }).proposals ?? [], cost };
  }

  async proposeTopics(req: TopicProposalRequest): Promise<AICallResult<ProposedTopic[]>> {
    const { json, cost } = await this.chatJson(
      "Eres el investigador de contenidos de un canal de YouTube. Propones ideas concretas apoyadas en fuentes, no categorias vagas.",
      buildTopicProposalPrompt(req),
      TOPIC_PROPOSAL_JSON_SCHEMA,
    );
    return { result: (json as { proposals?: ProposedTopic[] }).proposals ?? [], cost };
  }

  async classifyDimension(req: DimensionClassificationRequest): Promise<AICallResult<string>> {
    const { json, cost } = await this.chatJson(
      "Clasificas guiones. Contestas solo con una de las opciones dadas, copiada literal.",
      buildDimensionClassificationPrompt(req),
      // El enum se arma con los buckets de ESTA pregunta: asi el modelo no puede inventar una
      // etiqueta fuera de la lista, que es justo lo que dejaba el guion sin clasificar.
      {
        name: "dimension_classification",
        schema: {
          type: "object",
          properties: { bucket: { type: "string", enum: req.buckets } },
          required: ["bucket"],
          additionalProperties: false,
        },
      },
    );
    return { result: String((json as { bucket?: string }).bucket ?? ""), cost };
  }

  async embed(req: EmbeddingRequest): Promise<AICallResult<number[]>> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.embeddingModel ?? "text-embedding-3-small",
        // text-embedding-3-* aguanta 8191 tokens, mucho mas que Ollama/Gemini, pero el tope existe
        // igual y un guion de 30 minutos lo alcanzaria — ver embedding-input.ts.
        input: truncateForEmbedding(req.text, EMBEDDING_CHAR_BUDGETS.openai),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { data: { embedding: number[] }[]; usage?: { prompt_tokens?: number } };
    const cost = estimateOpenAiCost(this.options.embeddingModel ?? "text-embedding-3-small", {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: 0,
    });
    return { result: data.data[0]!.embedding, cost };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * /v1/models trae de todo (embeddings, whisper, dall-e, tts, moderacion, modelos deprecados). Se
   * filtra a los que sirven para chat/JSON (chatJson los usa via /v1/chat/completions), que es lo
   * unico que este provider expone.
   */
  async listModels(): Promise<string[]> {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`OpenAI models request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { data: { id: string }[] };
    return data.data
      .map((m) => m.id)
      .filter((id) => /^(gpt-|chatgpt-|o[0-9])/.test(id))
      .filter((id) => !/(audio|realtime|embedding|whisper|tts|dall-e|image|moderation|transcribe|search)/.test(id))
      .sort();
  }
}
