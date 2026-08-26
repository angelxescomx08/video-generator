import { resolveEmbeddingProvider, willTruncate } from "@video-generator/ai-providers";
import { db, videoMemory, type MemoryContentType } from "@video-generator/db";
import type { ProviderCost } from "@video-generator/types";
import { logger } from "../util/logger";

export async function storeMemory(params: {
  themeId: string;
  videoId?: string;
  contentType: MemoryContentType;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<ProviderCost> {
  const embeddingProvider = await resolveEmbeddingProvider();

  // El provider recorta por su cuenta para no reventar contra el limite de contexto del modelo, pero
  // eso se aviso aqui: si no, un guion largo se embebe a medias y la busqueda semantica empeora sin
  // que nada lo indique. La fila de video_memory guarda el contenido COMPLETO; lo recortado es solo
  // el texto que se vectorizo.
  const budget = embeddingProvider.embeddingCharBudget;
  if (budget !== undefined && willTruncate(params.content, budget)) {
    logger.warn("Contenido mas largo que el contexto del modelo de embeddings, se vectoriza recortado", {
      contentType: params.contentType,
      videoId: params.videoId,
      provider: embeddingProvider.name,
      chars: params.content.length,
      budget,
    });
  }

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
