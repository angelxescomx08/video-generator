import { db, platformAccounts, publishedVideos, themes, videos, type PlatformAccount } from "@video-generator/db";
import { getBoss, publishJobPayloadSchema, QUEUES, type PublishJobPayload } from "@video-generator/queue";
import { resolveSocialProvider } from "@video-generator/social-providers";
import type {
  PlatformAccountRef,
  RemoteVideoMetadata,
  SocialPlatformProvider,
} from "@video-generator/social-providers";
import { and, eq } from "drizzle-orm";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
import { resolveAccessToken } from "../social/access-token";
import { STAGES } from "../pipeline/stage-context";
import { logger } from "../util/logger";

export async function handlePublishVideo(payload: PublishJobPayload): Promise<void> {
  const { videoId, platformAccountId } = publishJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  if (!video.renderOutputPath) throw new Error(`Video ${videoId} has not finished rendering`);

  const account = await db.query.platformAccounts.findFirst({ where: eq(platformAccounts.id, platformAccountId) });
  if (!account) throw new Error(`Platform account ${platformAccountId} not found`);

  // La categoria de YouTube se configura por tema: todos los videos de un tema son del mismo tipo
  // de contenido, asi que no tiene sentido pedirla video por video.
  const theme = await db.query.themes.findFirst({ where: eq(themes.id, video.themeId) });

  const title = video.title ?? "Untitled";

  await runStage(videoId, STAGES.publish!, async () => {
    const provider = resolveSocialProvider(account.platform as "youtube" | "facebook");
    const { accessToken, refreshToken } = await resolveAccessToken(account, provider);
    const accountRef = { accessToken, refreshToken, externalAccountId: account.externalAccountId ?? undefined };

    // Guarda 1 — ya publicado en esta cuenta: no se vuelve a subir.
    // Cubre el doble clic en la UI y el job encolado dos veces.
    const alreadyPublished = await db.query.publishedVideos.findFirst({
      where: and(eq(publishedVideos.videoId, videoId), eq(publishedVideos.platformAccountId, account.id)),
    });
    if (alreadyPublished) {
      logger.warn(`Video ${videoId} ya estaba publicado en esta cuenta, no se vuelve a subir`, {
        externalVideoId: alreadyPublished.externalVideoId,
      });
      return { externalVideoId: alreadyPublished.externalVideoId, externalUrl: alreadyPublished.externalUrl ?? "" };
    }

    // Guarda 2 — subida huerfana de un intento anterior: se adopta en vez de duplicar.
    // Es el caso que dejo dos videos identicos en el canal: el archivo llego a YouTube pero la
    // conexion murio antes de devolver el id, asi que no se guardo la fila y el reintento volvio a
    // subir. Buscar por titulo antes de subir es lo unico que puede detectarlo desde este lado.
    const orphan = await findOrphanUpload(provider, accountRef, title);
    if (orphan) {
      logger.warn(`Se encontro una subida previa de "${title}" sin registrar; se adopta en vez de duplicar`, {
        externalVideoId: orphan.externalVideoId,
      });
      await recordPublished(videoId, account, orphan.externalVideoId, orphan.publishedAt);
      return { externalVideoId: orphan.externalVideoId, externalUrl: youtubeUrl(orphan.externalVideoId) };
    }

    const result = await provider.publish(accountRef, {
      videoFilePath: video.renderOutputPath!,
      title,
      description: video.description ?? "",
      tags: video.tags ?? [],
      isShort: video.format === "short",
      categoryId: theme?.youtubeCategoryId ?? undefined,
    });

    await recordPublished(videoId, account, result.externalVideoId, new Date(), result.externalUrl);

    logger.info(`Published video ${videoId} to ${account.platform}`, { url: result.externalUrl });
    return result;
  });

  await setVideoStatus(videoId, "published");
  const boss = await getBoss();
  await boss.send(QUEUES.POLL_STATS, { videoId });
}

function youtubeUrl(externalVideoId: string): string {
  return `https://www.youtube.com/watch?v=${externalVideoId}`;
}

async function recordPublished(
  videoId: string,
  account: { id: string; platform: PlatformAccount["platform"] },
  externalVideoId: string,
  publishedAt: Date | null,
  externalUrl?: string,
): Promise<void> {
  await db.insert(publishedVideos).values({
    videoId,
    platformAccountId: account.id,
    platform: account.platform,
    externalVideoId,
    externalUrl: externalUrl ?? youtubeUrl(externalVideoId),
    publishedAt: publishedAt ?? new Date(),
  });
}

/**
 * Busca una subida previa con el mismo titulo que no quedo registrada.
 *
 * Nunca lanza: si la consulta falla, publicar es preferible a quedarse bloqueado, asi que se sigue
 * adelante asumiendo que no hay huerfana. El riesgo de ese fallback es un duplicado; el de abortar
 * seria no poder publicar nunca porque una consulta secundaria no responde.
 */
async function findOrphanUpload(
  provider: SocialPlatformProvider,
  accountRef: PlatformAccountRef,
  title: string,
): Promise<RemoteVideoMetadata | null> {
  if (!provider.findRecentUploadByTitle) return null;
  try {
    return await provider.findRecentUploadByTitle(accountRef, title);
  } catch (err) {
    logger.warn("No se pudo comprobar si el video ya estaba subido; se continua con la publicacion", {
      error: (err as Error).message,
    });
    return null;
  }
}
