import { resolveEmbeddingProvider } from "@video-generator/ai-providers";
import {
  db,
  feedback,
  generationHistory,
  videoMemory,
  type FactType,
} from "@video-generator/db";
import { cosineDistance, desc, eq, ne, and, inArray, sql } from "drizzle-orm";
import type { FeedbackSummary, MemoryContextItem } from "@video-generator/ai-providers";
import type { ProviderCost } from "@video-generator/types";

/** Top-k semantically similar past scripts/feedback/style-notes for this theme (RAG-lite recall). */
export async function retrieveMemoryContext(
  themeId: string,
  queryText: string,
  limit = 8,
): Promise<{ items: MemoryContextItem[]; cost: ProviderCost }> {
  const embeddingProvider = await resolveEmbeddingProvider();
  const { result: queryEmbedding, cost } = await embeddingProvider.embed({ text: queryText });

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

  const items = rows.map((r) => ({
    content: r.content,
    contentType: r.contentType,
    similarity: Number(r.similarity),
    metadata: (r.metadata as Record<string, unknown>) ?? undefined,
  }));
  return { items, cost };
}

/** Exact-match facts already used for this theme (e.g. specific Bible verses) — must not repeat. */
export async function getAvoidFacts(themeId: string, factTypes: FactType[]): Promise<string[]> {
  const rows = await db
    .select({ factValue: generationHistory.factValue })
    .from(generationHistory)
    .where(and(eq(generationHistory.themeId, themeId), inArray(generationHistory.factType, factTypes)));
  return rows.map((r) => r.factValue);
}

/**
 * Feedback estructurado reciente, del tema primero y del resto del canal despues.
 *
 * El feedback de otros temas se incluye porque casi todo lo que el usuario comenta es transversal
 * ("la voz va muy rapido", "el final se corta"): son defectos de produccion, no del tema. Se marca
 * su `scope` para que el prompt pueda decirle al modelo cual viene de este tema y cual del canal en
 * general, y no confunda una nota sobre otro tema con una instruccion sobre este.
 */
export async function getRecentFeedback(themeId: string, limit = 10): Promise<FeedbackSummary[]> {
  const columns = { rating: feedback.rating, comment: feedback.comment, createdAt: feedback.createdAt };

  const [themeRows, channelRows] = await Promise.all([
    db
      .select(columns)
      .from(feedback)
      .where(eq(feedback.themeId, themeId))
      .orderBy(desc(feedback.createdAt))
      .limit(limit),
    db
      .select(columns)
      .from(feedback)
      .where(ne(feedback.themeId, themeId))
      .orderBy(desc(feedback.createdAt))
      .limit(limit),
  ]);

  return [
    ...themeRows.map((r) => ({ ...r, scope: "theme" as const })),
    ...channelRows.map((r) => ({ ...r, scope: "channel" as const })),
  ];
}
