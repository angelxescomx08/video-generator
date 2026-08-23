import { decryptSecret, encryptSecret } from "@video-generator/config";
import { db, platformAccounts, publishedVideos, themes, videos } from "@video-generator/db";
import { getBoss, publishJobPayloadSchema, QUEUES, type PublishJobPayload } from "@video-generator/queue";
import { resolveSocialProvider } from "@video-generator/social-providers";
import { eq } from "drizzle-orm";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
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

  await runStage(videoId, STAGES.publish!, async () => {
    const provider = resolveSocialProvider(account.platform as "youtube" | "facebook");

    let accessToken = decryptSecret(account.accessToken);
    const refreshToken = account.refreshToken ? decryptSecret(account.refreshToken) : undefined;

    const isExpiringSoon = account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;
    if (isExpiringSoon && refreshToken) {
      const refreshed = await provider.refreshTokens(refreshToken);
      accessToken = refreshed.accessToken;
      await db
        .update(platformAccounts)
        .set({
          accessToken: encryptSecret(refreshed.accessToken),
          tokenExpiresAt: refreshed.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(platformAccounts.id, account.id));
    }

    const result = await provider.publish(
      { accessToken, refreshToken, externalAccountId: account.externalAccountId ?? undefined },
      {
        videoFilePath: video.renderOutputPath!,
        title: video.title ?? "Untitled",
        description: video.description ?? "",
        tags: video.tags ?? [],
        isShort: video.format === "short",
        categoryId: theme?.youtubeCategoryId ?? undefined,
      },
    );

    await db.insert(publishedVideos).values({
      videoId,
      platformAccountId: account.id,
      platform: account.platform,
      externalVideoId: result.externalVideoId,
      externalUrl: result.externalUrl,
      publishedAt: new Date(),
    });

    logger.info(`Published video ${videoId} to ${account.platform}`, { url: result.externalUrl });
    return result;
  });

  await setVideoStatus(videoId, "published");
  const boss = await getBoss();
  await boss.send(QUEUES.POLL_STATS, { videoId });
}
