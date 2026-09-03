import { editDecisionListSchema, type EditDecisionList, type ProviderCost } from "@video-generator/types";
import { estimateAnthropicCost } from "./pricing";
import { parseScriptResult } from "./script-result";
import { buildScriptUserPrompt } from "./script-context";
import { buildDimensionClassificationPrompt, buildDimensionProposalPrompt, MUSIC_SUGGESTION_INSTRUCTION, NotImplementedError, SCENE_EFFECT_INSTRUCTION, VISUAL_KEYWORDS_INSTRUCTION, type AICallResult, type DimensionClassificationRequest, type DimensionProposalRequest, type ProposedDimension, type AIProvider, type EDLGenerationRequest, type EmbeddingRequest, type ScriptGenerationRequest, type ScriptGenerationResult } from "./types";

interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
}

function extractJsonBlock(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in Anthropic response");
  return JSON.parse(match[0]);
}

/**
 * Ready to activate via AI_PROVIDER=anthropic + ANTHROPIC_API_KEY. Anthropic has no public
 * embeddings API, so embed() throws NotImplementedError — set EMBEDDING_PROVIDER to "ollama"
 * or "openai" independently (see packages/config env schema and ai-providers/registry.ts).
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  constructor(private readonly options: AnthropicProviderOptions) {}

  private async messageJson(systemPrompt: string, userPrompt: string): Promise<{ json: unknown; cost: ProviderCost }> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.options.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: 4096,
        system: `${systemPrompt}\n\nResponde UNICAMENTE con un objeto JSON valido, sin texto adicional ni markdown.`,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      content: { type: string; text: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const textBlock = data.content.find((c) => c.type === "text");
    if (!textBlock) throw new Error("Anthropic response had no text block");
    const cost = estimateAnthropicCost(this.options.model, {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });
    return { json: extractJsonBlock(textBlock.text), cost };
  }

  async generateScript(req: ScriptGenerationRequest): Promise<AICallResult<ScriptGenerationResult>> {
    const userPrompt = buildScriptUserPrompt(
      req,
      `Devuelve JSON con title, description, script, scenes[], tags[], extractedFacts[]. ${VISUAL_KEYWORDS_INSTRUCTION}`,
    );
    const { json, cost } = await this.messageJson(req.systemPrompt, userPrompt);
    return { result: parseScriptResult(this.name, json), cost };
  }

  async generateEDL(req: EDLGenerationRequest): Promise<AICallResult<EditDecisionList>> {
    const userPrompt = `Genera una Edit Decision List JSON para estas escenas: ${JSON.stringify(req.scenes)}, formato ${req.format}, clips: ${JSON.stringify(req.availableClips)}.\n\n${SCENE_EFFECT_INSTRUCTION}\n\n${MUSIC_SUGGESTION_INSTRUCTION}`;
    const { json, cost } = await this.messageJson("Eres un editor de video experto.", userPrompt);
    const parsed = editDecisionListSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Anthropic returned an invalid EDL: ${parsed.error.message}`);
    }
    return { result: parsed.data, cost };
  }

  async proposeDimensions(req: DimensionProposalRequest): Promise<AICallResult<ProposedDimension[]>> {
    const { json, cost } = await this.messageJson(
      "Eres un analista de contenido que busca patrones en guiones de video. Propones hipotesis, no conclusiones.",
      buildDimensionProposalPrompt(req),
    );
    return { result: (json as { proposals?: ProposedDimension[] }).proposals ?? [], cost };
  }

  async classifyDimension(req: DimensionClassificationRequest): Promise<AICallResult<string>> {
    const { json, cost } = await this.messageJson(
      "Clasificas guiones. Contestas solo con una de las opciones dadas, copiada literal.",
      buildDimensionClassificationPrompt(req),
    );
    return { result: String((json as { bucket?: string }).bucket ?? ""), cost };
  }

  async embed(_req: EmbeddingRequest): Promise<AICallResult<number[]>> {
    throw new NotImplementedError(this.name, "embed");
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01" },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!response.ok) {
      throw new Error(`Anthropic models request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { data: { id: string }[] };
    return data.data.map((m) => m.id);
  }
}
