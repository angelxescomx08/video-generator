import { resolveEmbeddingProvider } from "@video-generator/ai-providers";
import { db, videoMemory, type MemoryContentType } from "@video-generator/db";
import type { ProviderCost } from "@video-generator/types";

export async function storeMemory(params: {
  themeId: string;
  videoId?: string;
  contentType: MemoryContentType;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<ProviderCost> {
  const embeddingProvider = await resolveEmbeddingProvider();
  const { result: embedding, cost } = await embeddingProvider.embed({ text: params.content });

  await db.insert(videoMemory).values({
    themeId: params.themeId,
    videoId: params.videoId,
    contentType: params.contentType,
    content: params.content,
    embedding,
    metadata: params.metadata,
  });

  return cost;
}
