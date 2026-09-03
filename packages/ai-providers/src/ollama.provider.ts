import { editDecisionListSchema, type EditDecisionList } from "@video-generator/types";
import { ollamaCost } from "./pricing";
import { EMBEDDING_CHAR_BUDGETS, truncateForEmbedding } from "./embedding-input";
import { buildScriptUserPrompt } from "./script-context";
import { buildDimensionClassificationPrompt, buildDimensionProposalPrompt, MUSIC_SUGGESTION_INSTRUCTION, SCENE_EFFECT_INSTRUCTION, VISUAL_KEYWORDS_INSTRUCTION } from "./types";
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

interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  embeddingModel: string;
}

const SCRIPT_JSON_INSTRUCTIONS = `
Responde UNICAMENTE con JSON valido con esta forma exacta, sin texto adicional:
{
  "title": string,
  "description": string,
  "script": string,
  "scenes": [{ "index": number, "narrationText": string, "estimatedDurationSeconds": number, "visualKeywords": string[], "captionText": string }],
  "tags": string[],
  "extractedFacts": [{ "factType": string, "factValue": string }]
}

${VISUAL_KEYWORDS_INSTRUCTION}`;

const EDL_JSON_INSTRUCTIONS = `
Responde UNICAMENTE con JSON valido que sea una Edit Decision List con esta forma (version siempre 1):
{
  "version": 1,
  "format": "long" | "short",
  "totalDurationSeconds": number,
  "audio": { "voiceoverPath": "", "musicSuggestionTags": string[] },
  "captions": { "enabled": true, "style": { "fontFamily": "Arial", "fontSizePx": 42, "color": "#FFFFFF", "position": "bottom" } },
  "scenes": [{
    "index": number,
    "startSeconds": number,
    "durationSeconds": number,
    "clip": { "sourcePath": "", "mediaType": "video" | "image" },
    "effect": { "type": "none" } | { "type": "ken_burns", "direction": "in" | "out", "panX": "left" | "right" | "center", "panY": "up" | "down" | "center" } | { "type": "zoom_punch", "intensity": "low" | "medium" | "high" },
    "transitionOut": { "type": "cut" } | { "type": "crossfade", "durationSeconds": number } | { "type": "fade_black", "durationSeconds": number },
    "captionText": string
  }]
}
Deja "sourcePath" vacio, se rellena despues. No inventes clips fuera de los indices de escena recibidos.

${SCENE_EFFECT_INSTRUCTION}

${MUSIC_SUGGESTION_INSTRUCTION}`;

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  readonly embeddingCharBudget = EMBEDDING_CHAR_BUDGETS.ollama;

  constructor(private readonly options: OllamaProviderOptions) {}

  private async chatJson(systemPrompt: string, userPrompt: string): Promise<unknown> {
    const response = await fetch(`${this.options.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        format: "json",
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return JSON.parse(data.message.content);
  }

  async generateScript(req: ScriptGenerationRequest): Promise<AICallResult<ScriptGenerationResult>> {
    const userPrompt = buildScriptUserPrompt(req, SCRIPT_JSON_INSTRUCTIONS);
    const raw = await this.chatJson(req.systemPrompt, userPrompt);
    return { result: raw as ScriptGenerationResult, cost: ollamaCost(this.options.model) };
  }

  async generateEDL(req: EDLGenerationRequest): Promise<AICallResult<EditDecisionList>> {
    const scenesBlock = req.scenes
      .map(
        (s) =>
          `Escena ${s.index}: "${s.narrationText}" (~${s.estimatedDurationSeconds}s) keywords=[${s.visualKeywords.join(", ")}]`,
      )
      .join("\n");
    const clipsBlock = req.availableClips
      .map((c) => `- escena candidata: id=${c.id} provider=${c.provider} tipo=${c.mediaType}`)
      .join("\n");

    const userPrompt = `Formato de video: ${req.format}
Escenas del guion:
${scenesBlock}

Clips disponibles:
${clipsBlock}

${EDL_JSON_INSTRUCTIONS}`;

    const raw = await this.chatJson(
      "Eres un editor de video experto que decide efectos y transiciones por escena.",
      userPrompt,
    );
    const parsed = editDecisionListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Ollama returned an invalid EDL: ${parsed.error.message}`);
    }
    return { result: parsed.data, cost: ollamaCost(this.options.model) };
  }

  async proposeDimensions(req: DimensionProposalRequest): Promise<AICallResult<ProposedDimension[]>> {
    const raw = await this.chatJson(
      "Eres un analista de contenido que busca patrones en guiones de video. Propones hipotesis, no conclusiones.",
      buildDimensionProposalPrompt(req),
    );
    return {
      result: (raw as { proposals?: ProposedDimension[] }).proposals ?? [],
      cost: ollamaCost(this.options.model),
    };
  }

  async classifyDimension(req: DimensionClassificationRequest): Promise<AICallResult<string>> {
    const raw = await this.chatJson(
      "Clasificas guiones. Contestas solo con una de las opciones dadas, copiada literal.",
      buildDimensionClassificationPrompt(req),
    );
    return { result: String((raw as { bucket?: string }).bucket ?? ""), cost: ollamaCost(this.options.model) };
  }

  async embed(req: EmbeddingRequest): Promise<AICallResult<number[]>> {
    // Pasarse del contexto del modelo no trunca, revienta con 500 "the input length exceeds the
    // context length" — ver embedding-input.ts.
    const text = truncateForEmbedding(req.text, EMBEDDING_CHAR_BUDGETS.ollama);
    const response = await fetch(`${this.options.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.options.embeddingModel, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return { result: data.embedding, cost: ollamaCost(this.options.embeddingModel) };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.options.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /** /api/tags lista lo YA descargado localmente, no un catalogo remoto — es lo que se puede usar ya. */
  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.options.baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama tags request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { models: { name: string }[] };
    return data.models.map((m) => m.name).sort();
  }
}
