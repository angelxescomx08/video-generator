import { editDecisionListSchema, type EditDecisionList, type ProviderCost } from "@video-generator/types";
import { estimateOpenAiCost } from "./pricing";
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
  readonly embeddingCharBudget = EMBEDDING_CHAR_BUDGETS.openai;

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
    const userPrompt = buildScriptUserPrompt(
      req,
      `Devuelve JSON con: title, description, script, scenes[], tags[], extractedFacts[]. ${VISUAL_KEYWORDS_INSTRUCTION}`,
    );
    const { json, cost } = await this.chatJson(req.systemPrompt, userPrompt);
    return { result: json as ScriptGenerationResult, cost };
  }

  async generateEDL(req: EDLGenerationRequest): Promise<AICallResult<EditDecisionList>> {
    const userPrompt = `Genera una Edit Decision List (JSON) para ${req.scenes.length} escenas, formato ${req.format}. Escenas: ${JSON.stringify(req.scenes)}. Clips disponibles: ${JSON.stringify(req.availableClips)}.\n\n${SCENE_EFFECT_INSTRUCTION}\n\n${MUSIC_SUGGESTION_INSTRUCTION}`;
    const { json, cost } = await this.chatJson("Eres un editor de video experto.", userPrompt);
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
    );
    return { result: (json as { proposals?: ProposedDimension[] }).proposals ?? [], cost };
  }

  async classifyDimension(req: DimensionClassificationRequest): Promise<AICallResult<string>> {
    const { json, cost } = await this.chatJson(
      "Clasificas guiones. Contestas solo con una de las opciones dadas, copiada literal.",
      buildDimensionClassificationPrompt(req),
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
