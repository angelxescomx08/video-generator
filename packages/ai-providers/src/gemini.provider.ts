import { editDecisionListSchema, type EditDecisionList } from "@video-generator/types";
import { VISUAL_KEYWORDS_INSTRUCTION } from "./types";
import type {
  AIProvider,
  EDLGenerationRequest,
  EmbeddingRequest,
  ScriptGenerationRequest,
  ScriptGenerationResult,
} from "./types";

interface GeminiProviderOptions {
  apiKey: string;
  model: string;
}

/** Ready to activate via AI_PROVIDER=gemini + GOOGLE_GEMINI_API_KEY. */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  constructor(private readonly options: GeminiProviderOptions) {}

  private async generateJson(systemPrompt: string, userPrompt: string): Promise<unknown> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.options.model}:generateContent?key=${this.options.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      candidates: { content: { parts: { text: string }[] } }[];
    };
    return JSON.parse(data.candidates[0]!.content.parts[0]!.text);
  }

  async generateScript(req: ScriptGenerationRequest): Promise<ScriptGenerationResult> {
    const regenerationBlock = req.regenerationInstruction
      ? `INSTRUCCION ESPECIFICA PARA ESTA NUEVA VERSION (prioridad sobre el resto del contexto): ${req.regenerationInstruction}\n\n`
      : "";
    const userPrompt = `${regenerationBlock}${req.userPromptTemplate}\n\nTema: ${req.themeSlug}\nFormato: ${req.format}\nDuracion objetivo: ${req.targetDurationSeconds}s\nDevuelve JSON con title, description, script, scenes[], tags[], extractedFacts[]. ${VISUAL_KEYWORDS_INSTRUCTION}`;
    const raw = await this.generateJson(req.systemPrompt, userPrompt);
    return raw as ScriptGenerationResult;
  }

  async generateEDL(req: EDLGenerationRequest): Promise<EditDecisionList> {
    const userPrompt = `Genera una Edit Decision List JSON para estas escenas: ${JSON.stringify(req.scenes)}, formato ${req.format}, clips: ${JSON.stringify(req.availableClips)}.`;
    const raw = await this.generateJson("Eres un editor de video experto.", userPrompt);
    const parsed = editDecisionListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Gemini returned an invalid EDL: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async embed(req: EmbeddingRequest): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.options.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text: req.text }] } }),
    });

    if (!response.ok) {
      throw new Error(`Gemini embeddings request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { embedding: { values: number[] } };
    return data.embedding.values;
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
