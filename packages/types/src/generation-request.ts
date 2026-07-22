import { z } from "zod";

export const createVideoRequestSchema = z.object({
  themeId: z.string().uuid(),
  format: z.enum(["long", "short"]),
  topic: z.string().min(1).optional(),
  targetDurationSeconds: z.number().int().min(10).max(1800).default(60),
  autoPublish: z.boolean().default(false),
  captionsEnabled: z.boolean().default(false),
});
export type CreateVideoRequest = z.infer<typeof createVideoRequestSchema>;

export const createFeedbackRequestSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  structuredRatings: z.record(z.string(), z.number()).optional(),
  comment: z.string().optional(),
});
export type CreateFeedbackRequest = z.infer<typeof createFeedbackRequestSchema>;

export const regenerateVideoRequestSchema = z.object({
  feedbackId: z.string().uuid().optional(),
});
export type RegenerateVideoRequest = z.infer<typeof regenerateVideoRequestSchema>;

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
