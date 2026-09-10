import { db, feedback, platformAccounts, publishedVideos, statsSyncRuns, videoStats, videos } from "@video-generator/db";
import { pollStatsPayloadSchema, type PollStatsPayload } from "@video-generator/queue";
import { resolveSocialProvider } from "@video-generator/social-providers";
import type {
  PlatformAccountRef,
  SocialPlatformProvider,
  StatsSnapshot,
} from "@video-generator/social-providers";
import { MIN_DAYS_FOR_LEARNING, MIN_VIEWS_FOR_LEARNING } from "@video-generator/types";
import { eq, sql } from "drizzle-orm";
import { describeVideoAttributes, extractVideoAttributes } from "@video-generator/analytics";
import { resolveAccessToken } from "../social/access-token";
import { logger } from "../util/logger";

export async function handlePollStats(payload: PollStatsPayload): Promise<void> {
  const { videoId, publishedVideoId, syncRunId } = pollStatsPayloadSchema.parse(payload);

  const rows = publishedVideoId
    ? await db
        .select()
        .from(publishedVideos)
        .innerJoin(platformAccounts, eq(publishedVideos.platformAccountId, platformAccounts.id))
        .where(eq(publishedVideos.id, publishedVideoId))
    : videoId
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

    let succeeded = false;
    try {
      const provider = resolveSocialProvider(account.platform as "youtube" | "facebook");
      // Refresca el token si esta por vencer: los de Google duran una hora, asi que sin esto el poll
      // recurrente solo funciona en la primera vuelta despues de conectar la cuenta.
      const { accessToken, refreshToken } = await resolveAccessToken(account, provider);
      const accountRef = {
        accessToken,
        refreshToken,
        externalAccountId: account.externalAccountId ?? undefined,
      };

      // Un video vinculado a mano llega sin fecha de publicacion (apps/web no llama a la API), asi
      // que se rellena en el primer poll. Es tambien donde se valida el ID pegado: si YouTube no
      // conoce ese video, el vinculo esta mal y se marca en vez de seguir polleando en vano cada 6h.
      const publishedAt = published.publishedAt ?? (await backfillPublishedAt(published.id, provider, accountRef));
      if (publishedAt === INVALID_LINK) {
        logger.warn(`Linked YouTube video not found, marking link as failed`, {
          publishedVideoId: published.id,
          externalVideoId: published.externalVideoId,
        });
        continue;
      }

      const snapshot = await provider.fetchStats(accountRef, published.externalVideoId);

      const videoAgeDays = daysSince(publishedAt);

      await db.insert(videoStats).values({
        publishedVideoId: published.id,
        source: "api",
        videoAgeDays,
        views: snapshot.views,
        likes: snapshot.likes,
        comments: snapshot.comments,
        shares: snapshot.shares,
        impressions: snapshot.impressions,
        engagedViews: snapshot.engagedViews,
        subscribersGained: snapshot.subscribersGained,
        subscribersLost: snapshot.subscribersLost,
        avgViewDurationSeconds: numericOrNull(snapshot.avgViewDurationSeconds),
        avgViewPercentage: numericOrNull(snapshot.avgViewPercentage),
        watchTimeHours: numericOrNull(snapshot.watchTimeHours),
        impressionsCtr: numericOrNull(snapshot.impressionsCtr),
        stayedToWatchPercentage: numericOrNull(snapshot.stayedToWatchPercentage),
        retentionAtStartPercentage: numericOrNull(snapshot.retentionAtStartPercentage),
        retentionCurve: snapshot.retentionCurve,
        trafficSources: snapshot.trafficSources,
        rawPayload: snapshot.raw,
      });

      await maybeDeriveFeedbackFromStats(published.videoId, snapshot, videoAgeDays);

      succeeded = true;
      logger.info(`Stats polled for published video ${published.id}`, {
        views: snapshot.views,
        hasRetentionCurve: Boolean(snapshot.retentionCurve),
      });
    } catch (err) {
      logger.warn(`Failed to poll stats for published video ${published.id}`, { error: (err as Error).message });
    } finally {
      if (syncRunId) await recordSyncProgress(syncRunId, succeeded);
    }
  }
}

/**
 * Escribe feedback derivado de las estadisticas, comparando este video contra el promedio del CANAL
 * (todos los temas) y adjuntando los atributos que lo hicieron distinto.
 *
 * Los atributos son la parte que importa: sin ellos el feedback dice "a este video le fue mal", que
 * es intransferible a otro tema. Con ellos dice "a este video con gancho narrado y 10 escenas le fue
 * mal", que si se puede aplicar en cualquier tema. El analisis agregado vive en
 * @video-generator/analytics; esto es la nota cualitativa que acompana a ese analisis.
 */
async function maybeDeriveFeedbackFromStats(
  videoId: string,
  snapshot: StatsSnapshot,
  videoAgeDays: number | null,
): Promise<void> {
  // El gancho se juzga con la retencion inicial y, si YouTube aun no la publica, con el porcentaje
  // medio visto. Si no hay ninguna de las dos, no hay nada que aprender todavia.
  const outcome = snapshot.retentionAtStartPercentage ?? snapshot.avgViewPercentage;
  if (outcome === undefined) return;

  // Guardas contra aprender de ruido: los primeros dias YouTube sigue repartiendo impresiones y un
  // video con pocas vistas da porcentajes que se mueven enteros con un solo espectador. Sin esto, el
  // poll de las 6h escribiria feedback pesimista de todos los videos recien publicados.
  if (videoAgeDays !== null && videoAgeDays < MIN_DAYS_FOR_LEARNING) return;
  const sampleSize = snapshot.engagedViews ?? snapshot.views;
  if (sampleSize < MIN_VIEWS_FOR_LEARNING) return;

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) return;

  const baseline = await channelBaselineCached();
  if (baseline === null) return;

  const delta = outcome - baseline;
  if (Math.abs(delta) < 10) return; // aun no es una diferencia significativa

  const attributes = extractVideoAttributes(video);
  const verdict = delta > 0 ? "por encima" : "por debajo";
  const advice =
    delta > 0
      ? "Este conjunto de decisiones funciono: vale repetirlo."
      : "Revisar el gancho y el ritmo antes de repetir estas decisiones.";

  await db.insert(feedback).values({
    videoId,
    themeId: video.themeId,
    rating: delta > 0 ? 5 : 2,
    comment: `Retencion ${outcome.toFixed(1)}%, ${Math.abs(delta).toFixed(1)} puntos ${verdict} del promedio del canal (${baseline.toFixed(1)}%). Como se hizo: ${describeVideoAttributes(attributes)}. Gancho: "${attributes.hookText ?? "N/D"}". ${advice}`,
    structuredRatings: { retentionPercentage: outcome, channelBaseline: baseline, deltaPoints: delta },
    source: "auto_derived_from_stats",
  });
}

/** A short cache prevents a four-job sync batch from repeatedly scanning the full stats history. */
let baselineCache: { value: number | null; expiresAt: number } | null = null;
async function channelBaselineCached(): Promise<number | null> {
  const now = Date.now();
  if (baselineCache && baselineCache.expiresAt > now) return baselineCache.value;
  const value = await channelBaseline();
  baselineCache = { value, expiresAt: now + 60_000 };
  return value;
}
/**
 * Promedio de retencion del canal COMPLETO, no del tema. Es el cambio central de este feedback loop:
 * comparar contra el propio tema hace que cada tema se mida contra si mismo y nunca se detecte que un
 * tema entero rinde peor que el resto — ademas de que, con pocos videos por tema, el promedio del
 * tema es practicamente el video mismo y el delta siempre sale cero.
 */
async function channelBaseline(): Promise<number | null> {
  const rows = await db
    .select({
      retentionAtStartPercentage: videoStats.retentionAtStartPercentage,
      avgViewPercentage: videoStats.avgViewPercentage,
      publishedVideoId: videoStats.publishedVideoId,
      capturedAt: videoStats.capturedAt,
    })
    .from(videoStats);

  // Un solo snapshot por video (el ultimo), para que un video con mucho historial no pese mas.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = latest.get(row.publishedVideoId);
    if (!current || row.capturedAt > current.capturedAt) latest.set(row.publishedVideoId, row);
  }

  // toNumber devuelve undefined para null, en vez de dejar que `Number(null)` lo convierta en 0: un
  // video sin datos de Analytics no rindio 0%, simplemente no se ha medido. Contar esos ceros hundia
  // el promedio del canal y hacia que casi cualquier video pareciera "muy por encima del promedio".
  const values = [...latest.values()]
    .map((r) => toNumber(r.retentionAtStartPercentage) ?? toNumber(r.avgViewPercentage))
    .filter((v): v is number => v !== undefined);

  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Centinela: el video vinculado no existe en la plataforma, distinto de "no pude averiguarlo". */
const INVALID_LINK = Symbol("invalid-link");

/**
 * Rellena `published_videos.published_at` desde la plataforma la primera vez que se pollea un video
 * vinculado a mano, y de paso valida el vinculo.
 *
 * Devuelve INVALID_LINK si la plataforma no conoce el video (ID mal pegado), o null si el provider no
 * soporta la consulta — en ese caso se sigue adelante sin fecha, porque las estadisticas todavia
 * sirven aunque no se pueda calcular la edad.
 */
async function backfillPublishedAt(
  publishedVideoId: string,
  provider: SocialPlatformProvider,
  accountRef: PlatformAccountRef,
): Promise<Date | null | typeof INVALID_LINK> {
  if (!provider.fetchVideoMetadata) return null;

  const [row] = await db
    .select({ externalVideoId: publishedVideos.externalVideoId })
    .from(publishedVideos)
    .where(eq(publishedVideos.id, publishedVideoId))
    .limit(1);
  if (!row) return null;

  const metadata = await provider.fetchVideoMetadata(accountRef, row.externalVideoId);

  if (!metadata) {
    await db
      .update(publishedVideos)
      .set({ status: "failed" })
      .where(eq(publishedVideos.id, publishedVideoId));
    return INVALID_LINK;
  }

  if (metadata.publishedAt) {
    await db
      .update(publishedVideos)
      .set({ publishedAt: metadata.publishedAt })
      .where(eq(publishedVideos.id, publishedVideoId));
  }
  return metadata.publishedAt;
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

/** Las columnas `numeric` llegan como string; un null tiene que quedar en undefined, nunca en 0. */
function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Las columnas `numeric` de drizzle esperan string; undefined debe quedar en null, no en "0". */
function numericOrNull(value: number | undefined): string | null {
  return value === undefined ? null : value.toString();
}

/** Increments a durable run after every link, including provider failures that the poll tolerates. */
async function recordSyncProgress(syncRunId: string, succeeded: boolean): Promise<void> {
  const [run] = await db
    .update(statsSyncRuns)
    .set({
      status: "active",
      startedAt: sql`coalesce(${statsSyncRuns.startedAt}, now())`,
      completedCount: sql`${statsSyncRuns.completedCount} + ${succeeded ? 1 : 0}`,
      failedCount: sql`${statsSyncRuns.failedCount} + ${succeeded ? 0 : 1}`,
    })
    .where(eq(statsSyncRuns.id, syncRunId))
    .returning();
  if (!run) return;
  const finished = run.completedCount + run.failedCount >= run.totalCount;
  if (finished) {
    await db.update(statsSyncRuns).set({ status: "completed", completedAt: new Date() }).where(eq(statsSyncRuns.id, syncRunId));
  }
}



