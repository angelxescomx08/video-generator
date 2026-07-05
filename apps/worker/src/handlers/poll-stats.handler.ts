import { decryptSecret } from "@video-generator/config";
import { db, feedback, platformAccounts, publishedVideos, videoStats, videos } from "@video-generator/db";
import { pollStatsPayloadSchema, type PollStatsPayload } from "@video-generator/queue";
import { resolveSocialProvider } from "@video-generator/social-providers";
import { avg, eq } from "drizzle-orm";
import { logger } from "../util/logger";

export async function handlePollStats(payload: PollStatsPayload): Promise<void> {
  const { videoId } = pollStatsPayloadSchema.parse(payload);

  const rows = videoId
    ? await db
        .select()
        .from(publishedVideos)
        .innerJoin(platformAccounts, eq(publishedVideos.platformAccountId, platformAccounts.id))
        .where(eq(publishedVideos.videoId, videoId))
    : await db
        .select()
        .from(publishedVideos)
        .innerJoin(platformAccounts, eq(publishedVideos.platformAccountId, platformAccounts.id))
        .where(eq(publishedVideos.status, "published"));

  for (const row of rows) {
    const published = row.published_videos;
    const account = row.platform_accounts;

    try {
      const provider = resolveSocialProvider(account.platform as "youtube" | "facebook");
      const snapshot = await provider.fetchStats(
        { accessToken: decryptSecret(account.accessToken), externalAccountId: account.externalAccountId ?? undefined },
        published.externalVideoId,
      );

      await db.insert(videoStats).values({
        publishedVideoId: published.id,
        views: snapshot.views,
        likes: snapshot.likes,
        comments: snapshot.comments,
        shares: snapshot.shares,
        avgViewDurationSeconds: snapshot.avgViewDurationSeconds?.toString(),
        avgViewPercentage: snapshot.avgViewPercentage?.toString(),
        impressions: snapshot.impressions,
        rawPayload: snapshot.raw,
      });

      await maybeDeriveFeedbackFromStats(published.videoId, snapshot.avgViewPercentage);

      logger.info(`Stats polled for published video ${published.id}`, { views: snapshot.views });
    } catch (err) {
      logger.warn(`Failed to poll stats for published video ${published.id}`, { error: (err as Error).message });
    }
  }
}

/** Compares this video's retention against the theme's historical average and logs synthetic feedback. */
async function maybeDeriveFeedbackFromStats(videoId: string, avgViewPercentage?: number): Promise<void> {
  if (avgViewPercentage === undefined) return;

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) return;

  const averageRows = await db
    .select({ value: avg(videoStats.avgViewPercentage) })
    .from(videoStats)
    .innerJoin(publishedVideos, eq(videoStats.publishedVideoId, publishedVideos.id))
    .innerJoin(videos, eq(publishedVideos.videoId, videos.id))
    .where(eq(videos.themeId, video.themeId));

  const themeAverage = averageRows[0]?.value;
  const baseline = themeAverage ? Number(themeAverage) : avgViewPercentage;
  const delta = avgViewPercentage - baseline;

  if (Math.abs(delta) < 10) return; // not a meaningful signal yet

  await db.insert(feedback).values({
    videoId,
    themeId: video.themeId,
    rating: delta > 0 ? 5 : 2,
    comment:
      delta > 0
        ? `Alta retención (${avgViewPercentage.toFixed(1)}%) vs promedio del tema (${baseline.toFixed(1)}%) — este estilo resonó.`
        : `Baja retención (${avgViewPercentage.toFixed(1)}%) vs promedio del tema (${baseline.toFixed(1)}%) — revisar ritmo/estilo.`,
    source: "auto_derived_from_stats",
  });
}
