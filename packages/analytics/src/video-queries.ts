import { db, publishedVideos, videoVersions, videos, type Video } from "@video-generator/db";
import type { CostItem, RetentionPoint } from "@video-generator/types";
import { asc, desc, eq, sql } from "drizzle-orm";
import { getChannelOverview, type ChannelOverview } from "./channel-queries";

/**
 * Todo lo que necesita la pantalla de analiticas de UN video.
 *
 * Se expone como una sola funcion y no como seis porque el punto es que la pantalla haga UNA ronda
 * de consultas en paralelo y no una cascada: cada `await` suelto en un componente de servidor es un
 * viaje mas a la base antes de poder pintar nada. Aqui las cinco consultas salen juntas.
 */

export interface VideoDailyPoint {
  day: Date;
  views: number;
  likes: number;
  retentionAtStart: number | null;
  avgViewPercentage: number | null;
  ctr: number | null;
}

export interface VideoAnalytics {
  video: Video;
  published: {
    externalVideoId: string;
    externalUrl: string | null;
    publishedAt: Date | null;
    status: string;
  } | null;
  /** Una fila por dia con captura, la mas reciente de ese dia. Vacio si nunca se sincronizo. */
  daily: VideoDailyPoint[];
  latest: {
    capturedAt: Date;
    videoAgeDays: number | null;
    views: number | null;
    engagedViews: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    impressions: number | null;
    subscribersGained: number | null;
    avgViewDurationSeconds: number | null;
    avgViewPercentage: number | null;
    watchTimeHours: number | null;
    impressionsCtr: number | null;
    retentionAtStartPercentage: number | null;
    retentionCurve: RetentionPoint[] | null;
    trafficSources: Record<string, number> | null;
  } | null;
  /** Costo por version, de la mas vieja a la mas nueva. */
  versions: {
    id: string;
    versionNumber: number;
    createdAt: Date;
    costBreakdown: CostItem[] | null;
    costTotalUsd: string | null;
    costTotalMxn: string | null;
    exchangeRateUsed: string | null;
  }[];
  /** Contra que compararlo: los promedios del canal, para que un 42% se lea como bueno o malo. */
  channel: ChannelOverview;
}

export async function getVideoAnalytics(videoId: string): Promise<VideoAnalytics | null> {
  const [video, publishedRows, daily, latest, versions, channel] = await Promise.all([
    db.query.videos.findFirst({ where: eq(videos.id, videoId) }),
    db
      .select({
        id: publishedVideos.id,
        externalVideoId: publishedVideos.externalVideoId,
        externalUrl: publishedVideos.externalUrl,
        publishedAt: publishedVideos.publishedAt,
        status: publishedVideos.status,
      })
      .from(publishedVideos)
      .where(eq(publishedVideos.videoId, videoId))
      .orderBy(desc(publishedVideos.createdAt))
      .limit(1),
    getVideoDailySeries(videoId),
    getLatestVideoSnapshot(videoId),
    db
      .select({
        id: videoVersions.id,
        versionNumber: videoVersions.versionNumber,
        createdAt: videoVersions.createdAt,
        costBreakdown: videoVersions.costBreakdown,
        costTotalUsd: videoVersions.costTotalUsd,
        costTotalMxn: videoVersions.costTotalMxn,
        exchangeRateUsed: videoVersions.exchangeRateUsed,
      })
      .from(videoVersions)
      .where(eq(videoVersions.videoId, videoId))
      .orderBy(asc(videoVersions.versionNumber)),
    getChannelOverview(),
  ]);

  if (!video) return null;

  return {
    video,
    published: publishedRows[0] ?? null,
    daily,
    latest,
    // `cost_breakdown` es jsonb sin `$type` en el schema, asi que llega como `unknown`: se acota aqui,
    // en el limite entre la base y el resto del codigo, y no en cada componente que lo dibuje.
    versions: versions.map((v) => ({ ...v, costBreakdown: (v.costBreakdown as CostItem[] | null) ?? null })),
    channel,
  };
}

/**
 * La evolucion del video: un punto por dia, no un punto por captura.
 *
 * El poll inserta 4 snapshots diarios; graficarlos todos cuadruplica los puntos sin agregar
 * informacion (las metricas apenas se mueven en 6 horas). Se colapsa en Postgres con `DISTINCT ON`
 * por dia, que ademas mantiene la carga acotada aunque el video lleve anos publicado.
 */
async function getVideoDailySeries(videoId: string, days = 180): Promise<VideoDailyPoint[]> {
  const result = await db.execute<{
    day: Date;
    views: number;
    likes: number;
    retention: string | null;
    avg_view: string | null;
    ctr: string | null;
  }>(sql`
    select distinct on ((vs.captured_at at time zone 'UTC')::date)
      (vs.captured_at at time zone 'UTC')::date    as day,
      coalesce(vs.views, vs.engaged_views, 0)      as views,
      coalesce(vs.likes, 0)                        as likes,
      vs.retention_at_start_percentage             as retention,
      vs.avg_view_percentage                       as avg_view,
      vs.impressions_ctr                           as ctr
    from video_stats vs
    join published_videos pv on pv.id = vs.published_video_id
    where pv.video_id = ${videoId}
      and vs.captured_at >= now() - make_interval(days => ${days}::int)
    order by (vs.captured_at at time zone 'UTC')::date, vs.captured_at desc
  `);

  return result.rows.map((r) => ({
    day: new Date(r.day),
    views: Number(r.views),
    likes: Number(r.likes),
    retentionAtStart: nullableNumber(r.retention),
    avgViewPercentage: nullableNumber(r.avg_view),
    ctr: nullableNumber(r.ctr),
  }));
}

/**
 * La captura mas reciente, con las columnas pesadas (curva de retencion, fuentes de trafico) que a
 * proposito NO viajan en la serie diaria: son un jsonb por fila y solo interesa el ultimo.
 */
async function getLatestVideoSnapshot(videoId: string): Promise<VideoAnalytics["latest"]> {
  const result = await db.execute<Record<string, unknown>>(sql`
    select vs.*
    from video_stats vs
    join published_videos pv on pv.id = vs.published_video_id
    where pv.video_id = ${videoId}
    order by vs.captured_at desc
    limit 1
  `);

  const row = result.rows[0];
  if (!row) return null;

  return {
    capturedAt: new Date(row.captured_at as string),
    videoAgeDays: row.video_age_days as number | null,
    views: nullableNumber(row.views as string | null),
    engagedViews: nullableNumber(row.engaged_views as string | null),
    likes: nullableNumber(row.likes as string | null),
    comments: nullableNumber(row.comments as string | null),
    shares: nullableNumber(row.shares as string | null),
    impressions: nullableNumber(row.impressions as string | null),
    subscribersGained: nullableNumber(row.subscribers_gained as string | null),
    avgViewDurationSeconds: nullableNumber(row.avg_view_duration_seconds as string | null),
    avgViewPercentage: nullableNumber(row.avg_view_percentage as string | null),
    watchTimeHours: nullableNumber(row.watch_time_hours as string | null),
    impressionsCtr: nullableNumber(row.impressions_ctr as string | null),
    retentionAtStartPercentage: nullableNumber(row.retention_at_start_percentage as string | null),
    retentionCurve: (row.retention_curve as RetentionPoint[] | null) ?? null,
    trafficSources: (row.traffic_sources as Record<string, number> | null) ?? null,
  };
}

function nullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
