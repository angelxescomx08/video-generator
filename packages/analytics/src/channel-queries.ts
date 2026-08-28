import { db, publishedVideos, videoStats, videos } from "@video-generator/db";
import { desc, eq, sql } from "drizzle-orm";

/**
 * Consultas agregadas del canal completo.
 *
 * Regla de este archivo, igual que en `cost-queries.ts`: cada funcion es UNA ida a la base y agrega
 * en Postgres. `video_stats` es la tabla que no para de crecer (un snapshot cada 6h por video
 * publicado, para siempre), asi que ninguna pantalla puede permitirse traerla entera y reducirla en
 * JS. Todo lo que mira historico lleva ademas una ventana de dias, para que el trabajo dependa del
 * rango que se esta viendo y no de la antiguedad del canal.
 */

/**
 * El snapshot mas reciente de cada video publicado.
 *
 * `DISTINCT ON` + `ORDER BY (published_video_id, captured_at desc)` es exactamente la forma del
 * indice `video_stats_published_captured_idx`: Postgres salta al primer registro de cada grupo en
 * vez de ordenar la tabla. Es la consulta que alimenta la tabla de la pantalla general.
 */
export function latestSnapshotPerVideo() {
  return db
    .selectDistinctOn([publishedVideos.videoId], {
      videoId: videos.id,
      videoTitle: videos.title,
      format: videos.format,
      platform: publishedVideos.platform,
      externalUrl: publishedVideos.externalUrl,
      publishedAt: publishedVideos.publishedAt,
      views: videoStats.views,
      engagedViews: videoStats.engagedViews,
      likes: videoStats.likes,
      retentionAtStart: videoStats.retentionAtStartPercentage,
      avgViewPercentage: videoStats.avgViewPercentage,
      impressionsCtr: videoStats.impressionsCtr,
      subscribersGained: videoStats.subscribersGained,
      hasCurve: sql<boolean>`${videoStats.retentionCurve} is not null`,
      videoAgeDays: videoStats.videoAgeDays,
      capturedAt: videoStats.capturedAt,
    })
    .from(videoStats)
    .innerJoin(publishedVideos, eq(videoStats.publishedVideoId, publishedVideos.id))
    .innerJoin(videos, eq(publishedVideos.videoId, videos.id))
    .orderBy(publishedVideos.videoId, desc(videoStats.capturedAt));
}

export type LatestSnapshotRow = Awaited<ReturnType<typeof latestSnapshotPerVideo>>[number];

export interface ChannelOverview {
  videosWithStats: number;
  totalViews: number;
  totalLikes: number;
  totalSubscribers: number;
  /** Promedios sobre los videos que tienen ese dato; null si ninguno lo tiene todavia. */
  avgRetentionAtStart: number | null;
  avgViewPercentage: number | null;
  avgCtr: number | null;
  /** La mediana aguanta mejor un video viral que el promedio, que se lo lleva entero. */
  medianViews: number | null;
}

/**
 * Los totales del canal, calculados sobre el ultimo snapshot de cada video.
 *
 * Sumar TODOS los snapshots seria incorrecto, no solo lento: `views` es acumulado, asi que sumar el
 * historico contaria el mismo video una vez por cada captura. Este agregado se apoya en la subconsulta
 * `DISTINCT ON` para que cada video pese exactamente una vez.
 */
export async function getChannelOverview(): Promise<ChannelOverview> {
  const result = await db.execute<{
    videos: number;
    views: number;
    likes: number;
    subs: number;
    retention: number | null;
    avg_view: number | null;
    ctr: number | null;
    median_views: number | null;
  }>(sql`
    with latest as (
      select distinct on (vs.published_video_id)
        coalesce(vs.engaged_views, vs.views, 0) as views,
        coalesce(vs.likes, 0)                   as likes,
        coalesce(vs.subscribers_gained, 0)      as subs,
        vs.retention_at_start_percentage        as retention,
        vs.avg_view_percentage                  as avg_view,
        vs.impressions_ctr                      as ctr
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      where pv.status = 'published'
      order by vs.published_video_id, vs.captured_at desc
    )
    select
      count(*)::int                                            as videos,
      coalesce(sum(views), 0)::bigint                          as views,
      coalesce(sum(likes), 0)::bigint                          as likes,
      coalesce(sum(subs), 0)::bigint                           as subs,
      avg(retention)::double precision                         as retention,
      avg(avg_view)::double precision                          as avg_view,
      avg(ctr)::double precision                               as ctr,
      percentile_cont(0.5) within group (order by views)       as median_views
    from latest
  `);

  const row = result.rows[0];
  return {
    videosWithStats: row?.videos ?? 0,
    totalViews: Number(row?.views ?? 0),
    totalLikes: Number(row?.likes ?? 0),
    totalSubscribers: Number(row?.subs ?? 0),
    avgRetentionAtStart: nullableNumber(row?.retention),
    avgViewPercentage: nullableNumber(row?.avg_view),
    avgCtr: nullableNumber(row?.ctr),
    medianViews: nullableNumber(row?.median_views),
  };
}

export interface ChannelViewsPoint {
  day: Date;
  views: number;
  /** Cuantos videos aportaron una captura ese dia — advierte de dias con sincronizacion parcial. */
  videos: number;
}

/**
 * Vistas acumuladas del canal, dia a dia.
 *
 * Se toma una captura por video y por dia (la ultima de ese dia) y se suman: `views` es un contador
 * acumulado de YouTube, asi que la serie es "cuantas vistas totales tenia el canal ese dia", y sube
 * de forma monotona salvo que un video se despublique.
 *
 * `days` acota el escaneo. Es la diferencia entre una consulta cuyo costo depende del rango que se
 * mira y una cuyo costo crece para siempre con la edad del canal.
 */
export async function getChannelViewsSeries(days = 90): Promise<ChannelViewsPoint[]> {
  const result = await db.execute<{ day: Date; views: number; videos: number }>(sql`
    with per_day as (
      select distinct on (vs.published_video_id, (vs.captured_at at time zone 'UTC')::date)
        (vs.captured_at at time zone 'UTC')::date  as day,
        coalesce(vs.engaged_views, vs.views, 0)    as views
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      where pv.status = 'published'
        and vs.captured_at >= now() - make_interval(days => ${days}::int)
      order by vs.published_video_id, (vs.captured_at at time zone 'UTC')::date, vs.captured_at desc
    )
    select day, sum(views)::bigint as views, count(*)::int as videos
    from per_day
    group by day
    order by day
  `);

  return result.rows.map((r) => ({ day: new Date(r.day), views: Number(r.views), videos: r.videos }));
}

export interface PublicationPoint {
  videoId: string;
  title: string | null;
  publishedAt: Date;
  views: number;
  retentionAtStart: number | null;
  avgViewPercentage: number | null;
  ctr: number | null;
}

/**
 * Un punto por video publicado, en orden de publicacion, con como le fue.
 *
 * Es la serie con la que se responde "¿estamos mejorando?": si el aprendizaje sirve, la retencion
 * de los videos nuevos deberia estar por encima de la de los viejos. Ordenar por fecha de
 * PUBLICACION y no por fecha de captura es lo que hace legible esa lectura.
 *
 * `limit` corta por los mas recientes: la tendencia de los ultimos 200 videos es la que informa el
 * proximo, y dibujar mil puntos en un SVG no aporta nada que no diga la media movil.
 */
export async function getPublicationTimeline(limit = 200): Promise<PublicationPoint[]> {
  const result = await db.execute<{
    video_id: string;
    title: string | null;
    published_at: Date;
    views: number;
    retention: string | null;
    avg_view: string | null;
    ctr: string | null;
  }>(sql`
    select * from (
      select distinct on (vs.published_video_id)
        pv.video_id                             as video_id,
        v.title                                 as title,
        pv.published_at                         as published_at,
        coalesce(vs.engaged_views, vs.views, 0) as views,
        vs.retention_at_start_percentage        as retention,
        vs.avg_view_percentage                  as avg_view,
        vs.impressions_ctr                      as ctr
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      join videos v on v.id = pv.video_id
      where pv.status = 'published' and pv.published_at is not null
      order by vs.published_video_id, vs.captured_at desc
    ) t
    order by published_at desc
    limit ${limit}
  `);

  return result.rows
    .map((r) => ({
      videoId: r.video_id,
      title: r.title,
      publishedAt: new Date(r.published_at),
      views: Number(r.views),
      retentionAtStart: nullableNumber(r.retention),
      avgViewPercentage: nullableNumber(r.avg_view),
      ctr: nullableNumber(r.ctr),
    }))
    .reverse(); // la consulta corta por los mas recientes; la grafica los quiere cronologicos
}

/** Un `numeric` de Postgres llega como string, y un null debe seguir siendo null y no 0. */
function nullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
