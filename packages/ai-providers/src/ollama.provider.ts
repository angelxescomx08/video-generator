import { editDecisionListSchema, type EditDecisionList } from "@video-generator/types";
import { VISUAL_KEYWORDS_INSTRUCTION } from "./types";
import type {
  AIProvider,
  EDLGenerationRequest,
  EmbeddingRequest,
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
  "audio": { "voiceoverPath": "" },
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
Deja "sourcePath" vacio, se rellena despues. No inventes clips fuera de los indices de escena recibidos.`;

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

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

  async generateScript(req: ScriptGenerationRequest): Promise<ScriptGenerationResult> {
    const memoryBlock = req.memoryContext.map((m) => `- (${m.contentType}) ${m.content}`).join("\n") || "Ninguno";
    const avoidBlock = req.avoidFacts.length > 0 ? req.avoidFacts.join(", ") : "Ninguno";
    const feedbackBlock =
      req.recentFeedback.map((f) => `- rating=${f.rating ?? "N/A"} comentario="${f.comment ?? ""}"`).join("\n") ||
      "Ninguno";
    const regenerationBlock = req.regenerationInstruction
      ? `INSTRUCCION ESPECIFICA PARA ESTA NUEVA VERSION (prioridad sobre el resto del contexto): ${req.regenerationInstruction}\n\n`
      : "";

    const userPrompt = `${regenerationBlock}${req.userPromptTemplate}

Tema: ${req.themeSlug}
Formato: ${req.format}
Duracion objetivo: ${req.targetDurationSeconds} segundos
Tema/topico especifico: ${req.topic ?? "elige uno apropiado"}

Memoria de generaciones pasadas relevantes:
${memoryBlock}

No repitas exactamente estos hechos ya usados:
${avoidBlock}

Feedback reciente de la audiencia/usuario a considerar:
${feedbackBlock}

${SCRIPT_JSON_INSTRUCTIONS}`;

    const raw = await this.chatJson(req.systemPrompt, userPrompt);
    return raw as ScriptGenerationResult;
  }

  async generateEDL(req: EDLGenerationRequest): Promise<EditDecisionList> {
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
    return parsed.data;
  }

  async embed(req: EmbeddingRequest): Promise<number[]> {
    const response = await fetch(`${this.options.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.options.embeddingModel, prompt: req.text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.options.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
