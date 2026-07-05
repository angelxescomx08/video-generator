import { resolveEmbeddingProvider } from "@video-generator/ai-providers";
import {
  db,
  feedback,
  generationHistory,
  videoMemory,
  type FactType,
} from "@video-generator/db";
import { cosineDistance, desc, eq, and, sql } from "drizzle-orm";
import type { FeedbackSummary, MemoryContextItem } from "@video-generator/ai-providers";

/** Top-k semantically similar past scripts/feedback/style-notes for this theme (RAG-lite recall). */
export async function retrieveMemoryContext(
  themeId: string,
  queryText: string,
  limit = 8,
): Promise<MemoryContextItem[]> {
  const embeddingProvider = await resolveEmbeddingProvider();
  const queryEmbedding = await embeddingProvider.embed({ text: queryText });

  const similarity = sql<number>`1 - (${cosineDistance(videoMemory.embedding, queryEmbedding)})`;

  const rows = await db
    .select({
      content: videoMemory.content,
      contentType: videoMemory.contentType,
      metadata: videoMemory.metadata,
      similarity,
    })
    .from(videoMemory)
    .where(eq(videoMemory.themeId, themeId))
    .orderBy((t) => cosineDistance(videoMemory.embedding, queryEmbedding))
    .limit(limit);

  return rows.map((r) => ({
    content: r.content,
    contentType: r.contentType,
    similarity: Number(r.similarity),
    metadata: (r.metadata as Record<string, unknown>) ?? undefined,
  }));
}

/** Exact-match facts already used for this theme (e.g. specific Bible verses) — must not repeat. */
export async function getAvoidFacts(themeId: string, factTypes: FactType[]): Promise<string[]> {
  const rows = await db
    .select({ factValue: generationHistory.factValue })
    .from(generationHistory)
    .where(and(eq(generationHistory.themeId, themeId), sql`${generationHistory.factType} = ANY(${factTypes})`));
  return rows.map((r) => r.factValue);
}

/** Recent structured feedback for a theme, used alongside semantic memory recall. */
export async function getRecentFeedback(themeId: string, limit = 10): Promise<FeedbackSummary[]> {
  const rows = await db
    .select({ rating: feedback.rating, comment: feedback.comment, createdAt: feedback.createdAt })
    .from(feedback)
    .where(eq(feedback.themeId, themeId))
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
  return rows;
}
