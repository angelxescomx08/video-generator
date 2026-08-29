import { db, publishedVideos, videoStats, videos } from "@video-generator/db";
import { desc, eq, sql } from "drizzle-orm";
import type { Granularity, TimeRange } from "./time-range";

/**
 * Consultas agregadas del canal completo.
 *
 * Regla de este archivo, igual que en `cost-queries.ts`: cada funcion es UNA ida a la base y agrega
 * en Postgres. `video_stats` es la tabla que no para de crecer (un snapshot cada 6h por video
 * publicado, para siempre), asi que ninguna pantalla puede permitirse traerla entera y reducirla en
 * JS. Todo lo que mira historico lleva ademas una ventana de dias, para que el trabajo dependa del
 * rango que se esta viendo y no de la antiguedad del canal.
 */

/** `date_trunc` con la granularidad como parametro. Postgres acepta el nombre del cubo como texto. */
function bucketOf(granularity: Granularity, column: string) {
  return sql.raw(`date_trunc('${granularity}', ${column})`);
}

/** Filtro de ventana, o nada cuando el rango es "todo". */
function withinRange(days: number | null, column: string) {
  return days === null ? sql.raw("true") : sql`${sql.raw(column)} >= now() - make_interval(days => ${days}::int)`;
}

/**
 * El snapshot mas reciente de cada video publicado.
 *
 * `DISTINCT ON` + `ORDER BY (published_video_id, captured_at desc)` es exactamente la forma del
 * indice `video_stats_published_captured_idx`: Postgres salta al primer registro de cada grupo en
 * vez de ordenar la tabla.
 *
 * `limit` existe porque esta consulta alimenta una tabla que se pinta fila a fila: con mil videos,
 * traerlos todos para que el navegador dibuje mil `<tr>` es lento en los dos extremos. Las cifras
 * que deben mirar a TODO el canal (totales, distribucion, rankings) no salen de aqui — salen de
 * agregados en SQL, que devuelven decenas de filas pase lo que pase.
 */
export function latestSnapshotPerVideo(limit?: number) {
  const query = db
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

  return limit === undefined ? query : query.limit(limit);
}

export type LatestSnapshotRow = Awaited<ReturnType<typeof latestSnapshotPerVideo>>[number];

export interface ChannelOverview {
  videosWithStats: number;
  totalViews: number;
  totalLikes: number;
  totalSubscribers: number;
  /** Las tres etapas del embudo, sin mezclar: impresiones -> vistas -> vistas con permanencia. */
  totalImpressions: number;
  totalRawViews: number;
  totalEngagedViews: number;
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
    impressions: number;
    raw_views: number;
    engaged_views: number;
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
        coalesce(vs.impressions, 0)             as impressions,
        coalesce(vs.views, 0)                   as raw_views,
        coalesce(vs.engaged_views, 0)           as engaged_views,
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
      coalesce(sum(impressions), 0)::bigint                    as impressions,
      coalesce(sum(raw_views), 0)::bigint                      as raw_views,
      coalesce(sum(engaged_views), 0)::bigint                  as engaged_views,
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
    totalImpressions: Number(row?.impressions ?? 0),
    totalRawViews: Number(row?.raw_views ?? 0),
    totalEngagedViews: Number(row?.engaged_views ?? 0),
    avgRetentionAtStart: nullableNumber(row?.retention),
    avgViewPercentage: nullableNumber(row?.avg_view),
    avgCtr: nullableNumber(row?.ctr),
    medianViews: nullableNumber(row?.median_views),
  };
}

export interface ChannelBucket {
  bucket: Date;
  /** Vistas TOTALES del canal al cerrar el periodo (contador acumulado). */
  cumulativeViews: number | null;
  /** Vistas GANADAS durante el periodo. `null` en el primero: no hay contra que restar. */
  newViews: number | null;
  newLikes: number | null;
  newSubscribers: number | null;
  /** Videos publicados dentro del periodo. */
  published: number;
  avgRetentionAtStart: number | null;
  avgViewPercentage: number | null;
  /** Videos con captura en el periodo — avisa de periodos con sincronizacion parcial. */
  videosWithCapture: number;
}

/**
 * La serie temporal del canal, agrupada por dia / semana / mes / ano.
 *
 * DOS METRICAS, NO UNA, Y ES IMPORTANTE:
 *
 * `views` de YouTube es un contador ACUMULADO. Agrupar por semana sumando todas las capturas de la
 * semana no da "las vistas de esa semana": da el mismo video contado catorce veces. Por eso se toma
 * la ULTIMA captura de cada video dentro del cubo (`DISTINCT ON`) y se suman los videos entre si —
 * eso es el acumulado del canal al cerrar el periodo. Las vistas NUEVAS del periodo son la
 * diferencia contra el cubo anterior, que se calcula con `lag()` en la misma pasada.
 *
 * Las dos se grafican distinto y responden a preguntas distintas: el acumulado dice "cuanto llevo",
 * y el delta dice "como me fue ESTE mes", que es lo que de verdad se compara entre periodos.
 */
export async function getChannelSeries({ granularity, days }: TimeRange): Promise<ChannelBucket[]> {
  const bucket = bucketOf(granularity, "vs.captured_at");
  const pubBucket = bucketOf(granularity, "pv.published_at");

  const result = await db.execute<{
    bucket: Date;
    views: number | null;
    likes: number | null;
    subs: number | null;
    new_views: number | null;
    new_likes: number | null;
    new_subs: number | null;
    published: number;
    retention: number | null;
    avg_view: number | null;
    videos: number | null;
  }>(sql`
    with per_bucket as (
      select distinct on (vs.published_video_id, ${bucket})
        ${bucket}                               as bucket,
        coalesce(vs.engaged_views, vs.views, 0) as views,
        coalesce(vs.likes, 0)                   as likes,
        coalesce(vs.subscribers_gained, 0)      as subs,
        vs.retention_at_start_percentage        as retention,
        vs.avg_view_percentage                  as avg_view
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      where pv.status = 'published' and ${withinRange(days, "vs.captured_at")}
      order by vs.published_video_id, ${bucket}, vs.captured_at desc
    ),
    stats as (
      select
        bucket,
        sum(views)::bigint               as views,
        sum(likes)::bigint               as likes,
        sum(subs)::bigint                as subs,
        avg(retention)::double precision as retention,
        avg(avg_view)::double precision  as avg_view,
        count(*)::int                    as videos
      from per_bucket
      group by bucket
    ),
    pubs as (
      select ${pubBucket} as bucket, count(*)::int as published
      from published_videos pv
      where pv.status = 'published' and pv.published_at is not null
        and ${withinRange(days, "pv.published_at")}
      group by 1
    )
    select
      coalesce(s.bucket, p.bucket) as bucket,
      s.views, s.likes, s.subs, s.retention, s.avg_view, s.videos,
      coalesce(p.published, 0)     as published,
      s.views - lag(s.views) over (order by coalesce(s.bucket, p.bucket)) as new_views,
      s.likes - lag(s.likes) over (order by coalesce(s.bucket, p.bucket)) as new_likes,
      s.subs  - lag(s.subs)  over (order by coalesce(s.bucket, p.bucket)) as new_subs
    from stats s
    full outer join pubs p on p.bucket = s.bucket
    order by 1
  `);

  return result.rows.map((r) => ({
    bucket: new Date(r.bucket),
    cumulativeViews: nullableNumber(r.views),
    newViews: nullableNumber(r.new_views),
    newLikes: nullableNumber(r.new_likes),
    newSubscribers: nullableNumber(r.new_subs),
    published: r.published,
    avgRetentionAtStart: nullableNumber(r.retention),
    avgViewPercentage: nullableNumber(r.avg_view),
    videosWithCapture: r.videos ?? 0,
  }));
}

export interface PublicationPoint {
  videoId: string;
  title: string | null;
  publishedAt: Date;
  views: number;
  retentionAtStart: number | null;
  avgViewPercentage: number | null;
  ctr: number | null;
  costUsd: number;
}

/**
 * Un punto por video publicado, en orden de publicacion, con como le fue y cuanto costo.
 *
 * Es la serie con la que se responde "¿estamos mejorando?": si el aprendizaje sirve, la retencion
 * de los videos nuevos deberia estar por encima de la de los viejos. Ordenar por fecha de
 * PUBLICACION y no por fecha de captura es lo que hace legible esa lectura.
 *
 * Trae el costo porque la misma lista alimenta la nube de puntos de costo contra vistas: pedir dos
 * veces lo mismo para cruzarlo despues seria el patron que este paquete existe para evitar.
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
    cost_usd: number | null;
  }>(sql`
    select * from (
      select distinct on (vs.published_video_id)
        pv.video_id                             as video_id,
        v.title                                 as title,
        pv.published_at                         as published_at,
        coalesce(vs.engaged_views, vs.views, 0) as views,
        vs.retention_at_start_percentage        as retention,
        vs.avg_view_percentage                  as avg_view,
        vs.impressions_ctr                      as ctr,
        (
          select sum(coalesce(vv.cost_total_usd::double precision, 0))
          from video_versions vv
          where vv.video_id = pv.video_id
        )                                       as cost_usd
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
      costUsd: Number(r.cost_usd ?? 0),
    }))
    .reverse(); // la consulta corta por los mas recientes; la grafica los quiere cronologicos
}

export interface RetentionBin {
  /** Limite inferior del intervalo, en puntos porcentuales. */
  from: number;
  to: number;
  videos: number;
}

/**
 * Cuantos videos caen en cada franja de retencion.
 *
 * Un promedio de 45% puede ser "todos rinden 45" o "la mitad rinde 80 y la otra mitad 10", y son
 * dos canales completamente distintos: el primero necesita subir el techo y el segundo necesita
 * dejar de hacer los malos. El promedio no distingue; la distribucion si.
 *
 * `width_bucket` hace el conteo dentro de Postgres, asi que el resultado son ~10 filas aunque haya
 * mil videos. El techo se calcula sobre los datos porque en Shorts la retencion pasa de 100 (cuenta
 * las repeticiones), y recortar ahi escondería justo los mejores.
 */
export async function getRetentionDistribution(bins = 10): Promise<RetentionBin[]> {
  const result = await db.execute<{ bin: number; videos: number; bin_width: number }>(sql`
    with latest as (
      select distinct on (vs.published_video_id)
        vs.retention_at_start_percentage::double precision as retention
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      where pv.status = 'published' and vs.retention_at_start_percentage is not null
      order by vs.published_video_id, vs.captured_at desc
    ),
    -- El techo nunca baja de 100 aunque todos los videos rindan poco: una distribucion dibujada
    -- sobre una escala que se encoge con los datos exagera diferencias minimas.
    bounds as (select greatest(coalesce(max(retention), 100), 100) as top from latest),
    counted as (
      select least(width_bucket(l.retention, 0, b.top, ${bins}::int), ${bins}::int) as bin, count(*)::int as videos
      from latest l cross join bounds b
      group by 1
    )
    -- Todas las franjas salen siempre, tengan videos o no: un histograma al que le faltan las
    -- franjas vacias miente sobre la forma de la distribucion, que es justo lo unico que aporta.
    select
      g.bin                        as bin,
      coalesce(c.videos, 0)        as videos,
      (select top from bounds) / ${bins}::int as bin_width
    from generate_series(1, ${bins}::int) as g(bin)
    left join counted c on c.bin = g.bin
    order by g.bin
  `);

  const width = Number(result.rows[0]?.bin_width ?? 10);
  return result.rows.map((r) => ({
    from: (r.bin - 1) * width,
    to: r.bin * width,
    videos: Number(r.videos),
  }));
}

export interface RetentionHeatRow {
  videoId: string;
  title: string | null;
  publishedAt: Date;
  /** Un valor por decil del video (0-10%, 10-20%...): % de audiencia que seguia viendo ahi. */
  deciles: (number | null)[];
}

/**
 * La curva de retencion de varios videos, uno por fila, en deciles.
 *
 * Una curva sola dice donde se cae ESE video; diez curvas apiladas dicen si el canal tiene un
 * problema sistematico. Si toda la columna del 10-20% esta oscura, el problema no es un guion, es
 * como se estructuran todos los guiones despues del gancho.
 *
 * Los 100 puntos de cada curva se reducen a 10 dentro de Postgres (`jsonb_array_elements` +
 * agrupacion por decil), asi que lo que viaja son 10 numeros por video y no la curva entera. El
 * `limit` acota cuantos videos se comparan: mas de ~15 filas dejan de leerse de un vistazo.
 */
export async function getRetentionHeatmap(limit = 12): Promise<RetentionHeatRow[]> {
  const result = await db.execute<{
    video_id: string;
    title: string | null;
    published_at: Date;
    bin: number;
    watch: number;
  }>(sql`
    with latest as (
      select distinct on (vs.published_video_id)
        pv.video_id, v.title, pv.published_at, vs.retention_curve
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      join videos v on v.id = pv.video_id
      where pv.status = 'published' and vs.retention_curve is not null
      order by vs.published_video_id, vs.captured_at desc
    ),
    recent as (select * from latest order by published_at desc nulls last limit ${limit}),
    points as (
      select
        r.video_id,
        r.title,
        r.published_at,
        least(9, floor((p->>'elapsedRatio')::double precision * 10)::int) as bin,
        (p->>'watchRatio')::double precision * 100                        as watch
      from recent r
      cross join lateral jsonb_array_elements(r.retention_curve) p
    )
    select video_id, title, published_at, bin, avg(watch) as watch
    from points
    group by 1, 2, 3, 4
    order by published_at desc nulls last, bin
  `);

  const byVideo = new Map<string, RetentionHeatRow>();
  for (const row of result.rows) {
    const existing =
      byVideo.get(row.video_id) ??
      ({
        videoId: row.video_id,
        title: row.title,
        publishedAt: new Date(row.published_at),
        deciles: Array<number | null>(10).fill(null),
      } satisfies RetentionHeatRow);
    existing.deciles[row.bin] = Number(row.watch);
    byVideo.set(row.video_id, existing);
  }
  return [...byVideo.values()];
}

export interface WeekdayRow {
  /** 1 = lunes ... 7 = domingo (ISO). */
  weekday: number;
  videos: number;
  avgViews: number | null;
  avgRetentionAtStart: number | null;
}

/**
 * Rendimiento medio segun el dia de la semana en que se publico.
 *
 * Va como barras y no como mapa de calor a proposito: es UNA dimension (el dia), y un mapa de calor
 * de una sola fila obliga a leer magnitudes en tono, que es mucho mas dificil que leerlas en
 * longitud. El mapa de calor se reserva para el cruce de dos dimensiones (video x decil).
 *
 * Con pocos videos por dia esto es anecdota, no patron — por eso viaja el conteo: la UI puede decir
 * "3 videos" al lado del promedio en vez de presentarlo como una conclusion.
 */
export async function getWeekdayPerformance(): Promise<WeekdayRow[]> {
  const result = await db.execute<{ weekday: number; videos: number; views: number | null; retention: number | null }>(sql`
    with latest as (
      select distinct on (vs.published_video_id)
        extract(isodow from pv.published_at)::int          as weekday,
        coalesce(vs.engaged_views, vs.views, 0)            as views,
        vs.retention_at_start_percentage::double precision as retention
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      where pv.status = 'published' and pv.published_at is not null
      order by vs.published_video_id, vs.captured_at desc
    )
    select weekday, count(*)::int as videos, avg(views)::double precision as views,
           avg(retention)::double precision as retention
    from latest
    group by weekday
    order by weekday
  `);

  return result.rows.map((r) => ({
    weekday: r.weekday,
    videos: r.videos,
    avgViews: nullableNumber(r.views),
    avgRetentionAtStart: nullableNumber(r.retention),
  }));
}

export interface RankedVideo {
  videoId: string;
  title: string | null;
  value: number;
  views: number;
}

/**
 * Los mejores o peores videos por una metrica, resueltos en SQL.
 *
 * Traer todos los videos para ordenarlos en JS funciona con diez y no con mil: el `order by ... limit`
 * deja que Postgres descarte lo que no se va a dibujar.
 */
export async function getRankedByRetention(limit = 10, direction: "best" | "worst" = "best"): Promise<RankedVideo[]> {
  const order = direction === "best" ? sql.raw("desc") : sql.raw("asc");
  const result = await db.execute<{ video_id: string; title: string | null; value: number; views: number }>(sql`
    with latest as (
      select distinct on (vs.published_video_id)
        pv.video_id,
        v.title,
        vs.retention_at_start_percentage::double precision as value,
        coalesce(vs.engaged_views, vs.views, 0)            as views
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      join videos v on v.id = pv.video_id
      where pv.status = 'published' and vs.retention_at_start_percentage is not null
      order by vs.published_video_id, vs.captured_at desc
    )
    select video_id, title, value, views from latest order by value ${order} limit ${limit}
  `);

  return result.rows.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    value: Number(r.value),
    views: Number(r.views),
  }));
}

export interface LinkStatusCounts {
  published: number;
  failed: number;
}

/**
 * Cuantos vinculos con YouTube estan vivos y cuantos rotos.
 *
 * Dos contadores agregados en vez de traer `published_videos` entera para medirla en JS: la pantalla
 * solo necesita los numeros, y con mil videos publicados esa tabla ya no es "pequena".
 */
export async function getLinkStatusCounts(): Promise<LinkStatusCounts> {
  const result = await db.execute<{ published: number; failed: number }>(sql`
    select
      count(*) filter (where status = 'published')::int as published,
      count(*) filter (where status = 'failed')::int    as failed
    from published_videos
  `);
  return { published: result.rows[0]?.published ?? 0, failed: result.rows[0]?.failed ?? 0 };
}

/** Un `numeric` de Postgres llega como string, y un null debe seguir siendo null y no 0. */
function nullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
