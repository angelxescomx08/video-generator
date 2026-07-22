import { editDecisionListSchema, type EditDecisionList } from "@video-generator/types";
import { NotImplementedError, VISUAL_KEYWORDS_INSTRUCTION, type AIProvider, type EDLGenerationRequest, type EmbeddingRequest, type ScriptGenerationRequest, type ScriptGenerationResult } from "./types";

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

  private async messageJson(systemPrompt: string, userPrompt: string): Promise<unknown> {
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

    const data = (await response.json()) as { content: { type: string; text: string }[] };
    const textBlock = data.content.find((c) => c.type === "text");
    if (!textBlock) throw new Error("Anthropic response had no text block");
    return extractJsonBlock(textBlock.text);
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
Duracion objetivo: ${req.targetDurationSeconds}s
Idea / topico especifico (base del guion): ${req.topic ?? "elige uno apropiado"}

Memoria de generaciones pasadas relevantes:
${memoryBlock}

No repitas exactamente estos hechos ya usados:
${avoidBlock}

Feedback reciente de la audiencia/usuario a considerar:
${feedbackBlock}

${req.styleGuide ?? ""}

Devuelve JSON con title, description, script, scenes[], tags[], extractedFacts[]. ${VISUAL_KEYWORDS_INSTRUCTION}`;
    const raw = await this.messageJson(req.systemPrompt, userPrompt);
    return raw as ScriptGenerationResult;
  }

  async generateEDL(req: EDLGenerationRequest): Promise<EditDecisionList> {
    const userPrompt = `Genera una Edit Decision List JSON para estas escenas: ${JSON.stringify(req.scenes)}, formato ${req.format}, clips: ${JSON.stringify(req.availableClips)}.`;
    const raw = await this.messageJson("Eres un editor de video experto.", userPrompt);
    const parsed = editDecisionListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Anthropic returned an invalid EDL: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async embed(_req: EmbeddingRequest): Promise<number[]> {
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
}
