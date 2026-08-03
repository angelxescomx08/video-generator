import { editDecisionListSchema, type EditDecisionList, type ProviderCost } from "@video-generator/types";
import { estimateOpenAiCost } from "./pricing";
import { MUSIC_SUGGESTION_INSTRUCTION, VISUAL_KEYWORDS_INSTRUCTION } from "./types";
import type {
  AICallResult,
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

  private async chatJson(systemPrompt: string, userPrompt: string): Promise<{ json: unknown; cost: ProviderCost }> {
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

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const cost = estimateOpenAiCost(this.options.model, {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    });
    return { json: JSON.parse(data.choices[0]!.message.content), cost };
  }

  async generateScript(req: ScriptGenerationRequest): Promise<AICallResult<ScriptGenerationResult>> {
    const regenerationBlock = req.regenerationInstruction
      ? `INSTRUCCION ESPECIFICA PARA ESTA NUEVA VERSION (prioridad sobre el resto del contexto): ${req.regenerationInstruction}\n\n`
      : "";
    const userPrompt = `${regenerationBlock}${req.userPromptTemplate}\n\nTema: ${req.themeSlug}\nFormato: ${req.format}\nDuracion objetivo: ${req.targetDurationSeconds}s\nTopico: ${req.topic ?? "elige uno apropiado"}\n\n${req.styleGuide ?? ""}\n\nDevuelve JSON con: title, description, script, scenes[], tags[], extractedFacts[]. ${VISUAL_KEYWORDS_INSTRUCTION}`;
    const { json, cost } = await this.chatJson(req.systemPrompt, userPrompt);
    return { result: json as ScriptGenerationResult, cost };
  }

  async generateEDL(req: EDLGenerationRequest): Promise<AICallResult<EditDecisionList>> {
    const userPrompt = `Genera una Edit Decision List (JSON) para ${req.scenes.length} escenas, formato ${req.format}. Escenas: ${JSON.stringify(req.scenes)}. Clips disponibles: ${JSON.stringify(req.availableClips)}.\n\n${MUSIC_SUGGESTION_INSTRUCTION}`;
    const { json, cost } = await this.chatJson("Eres un editor de video experto.", userPrompt);
    const parsed = editDecisionListSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`OpenAI returned an invalid EDL: ${parsed.error.message}`);
    }
    return { result: parsed.data, cost };
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
        input: req.text,
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
}
