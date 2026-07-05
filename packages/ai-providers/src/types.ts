import type { EditDecisionList } from "@video-generator/types";
import type { StockClipRef } from "@video-generator/types";

export interface ScriptScene {
  index: number;
  narrationText: string;
  estimatedDurationSeconds: number;
  visualKeywords: string[];
  captionText?: string;
}

export interface MemoryContextItem {
  content: string;
  contentType: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface FeedbackSummary {
  rating: number | null;
  comment: string | null;
  createdAt: Date;
}

export interface ScriptGenerationRequest {
  themeSlug: string;
  systemPrompt: string;
  userPromptTemplate: string;
  topic?: string;
  format: "long" | "short";
  targetDurationSeconds: number;
  memoryContext: MemoryContextItem[];
  avoidFacts: string[];
  recentFeedback: FeedbackSummary[];
}

export interface ExtractedFact {
  factType: string;
  factValue: string;
}

export interface ScriptGenerationResult {
  title: string;
  description: string;
  script: string;
  scenes: ScriptScene[];
  tags: string[];
  extractedFacts: ExtractedFact[];
}

export interface EDLGenerationRequest {
  scenes: ScriptScene[];
  availableClips: StockClipRef[];
  format: "long" | "short";
  themeSlug: string;
}

export interface EmbeddingRequest {
  text: string;
}

export class NotImplementedError extends Error {
  constructor(providerName: string, method: string) {
    super(`${providerName} does not implement ${method} yet`);
    this.name = "NotImplementedError";
  }
}

export interface AIProvider {
  readonly name: string;
  generateScript(req: ScriptGenerationRequest): Promise<ScriptGenerationResult>;
  generateEDL(req: EDLGenerationRequest): Promise<EditDecisionList>;
  embed(req: EmbeddingRequest): Promise<number[]>;
  healthCheck(): Promise<boolean>;
}
