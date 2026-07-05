import { editDecisionListSchema, type EditDecisionList } from "@video-generator/types";
import type {
  AIProvider,
  EDLGenerationRequest,
  EmbeddingRequest,
  ScriptGenerationRequest,
  ScriptGenerationResult,
} from "./types";

interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  embeddingModel?: string;
}

/**
 * Full OpenAI Chat Completions (JSON mode) implementation. Ready to activate by setting
 * AI_PROVIDER=openai and OPENAI_API_KEY — no other code changes needed (see registry.ts).
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  constructor(private readonly options: OpenAIProviderOptions) {}

  private async chatJson(systemPrompt: string, userPrompt: string): Promise<unknown> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(data.choices[0]!.message.content);
  }

  async generateScript(req: ScriptGenerationRequest): Promise<ScriptGenerationResult> {
    const userPrompt = `${req.userPromptTemplate}\n\nTema: ${req.themeSlug}\nFormato: ${req.format}\nDuracion objetivo: ${req.targetDurationSeconds}s\nTopico: ${req.topic ?? "elige uno apropiado"}\n\nDevuelve JSON con: title, description, script, scenes[], tags[], extractedFacts[].`;
    const raw = await this.chatJson(req.systemPrompt, userPrompt);
    return raw as ScriptGenerationResult;
  }

  async generateEDL(req: EDLGenerationRequest): Promise<EditDecisionList> {
    const userPrompt = `Genera una Edit Decision List (JSON) para ${req.scenes.length} escenas, formato ${req.format}. Escenas: ${JSON.stringify(req.scenes)}. Clips disponibles: ${JSON.stringify(req.availableClips)}.`;
    const raw = await this.chatJson("Eres un editor de video experto.", userPrompt);
    const parsed = editDecisionListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`OpenAI returned an invalid EDL: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async embed(req: EmbeddingRequest): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.embeddingModel ?? "text-embedding-3-small",
        input: req.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { data: { embedding: number[] }[] };
    return data.data[0]!.embedding;
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
}
