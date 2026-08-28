import { db, DEFAULT_USD_TO_MXN_RATE } from "@video-generator/db";
import type { CostStage, CostUnitKind, ProviderKind } from "@video-generator/types";
import { sql } from "drizzle-orm";

/**
 * Agregaciones de costo sobre `video_versions.cost_breakdown`.
 *
 * POR QUE ES SQL CRUDO Y NO UN `map`/`reduce` EN JS
 *
 * El desglose de costo es un `jsonb` con ~5 objetos por version. Sumarlo en JS obliga a traer la
 * columna entera de todas las versiones de todos los videos: a mil videos con dos versiones cada
 * uno son 2000 blobs viajando por la red y descodificandose en cada carga de la pantalla de costos,
 * para acabar mostrando 8 numeros. `jsonb_to_recordset` desarma ese arreglo dentro de Postgres, que
 * agrupa y suma ahi mismo y devuelve una fila por (etapa, proveedor, modelo) — decenas de filas,
 * no miles. El tiempo de respuesta deja de depender de cuantos videos hay.
 *
 * Cada funcion de este archivo es UNA sola ida a la base. Ninguna consulta por video, ninguna en
 * bucle: ese es el patron que hay que mantener al agregar cortes nuevos.
 */

/** La forma de cada elemento del arreglo `cost_breakdown`, declarada para `jsonb_to_recordset`. */
const COST_ITEM_COLUMNS = sql`(
  stage text,
  "providerType" text,
  "providerName" text,
  model text,
  "isLocal" boolean,
  "isFree" boolean,
  "amountUsd" double precision,
  units double precision,
  "unitKind" text,
  detail text
)`;

/**
 * `video_versions` x sus items de costo, ya desarmados: una fila por item, no por version.
 *
 * Una version sin desglose guardado (renderizada antes de que existiera el calculo de costos) no
 * produce ninguna fila aqui, que es lo correcto: no aporto ningun costo conocido. Los totales que si
 * la tienen que contar (`getCostTotals`, `getCostByMonth`) no pasan por este lateral, leen la
 * columna `cost_total_usd` de la version directamente.
 */
const costItems = sql`
  from video_versions vv
  cross join lateral jsonb_to_recordset(coalesce(vv.cost_breakdown, '[]'::jsonb)) as item ${COST_ITEM_COLUMNS}
`;

/**
 * El modelo del item, con el mismo rescate de datos viejos que hace `costItemModel` en JS: antes de
 * que `model` fuera un campo propio, el nombre solo vivia dentro de `detail`, con la forma
 * `"1234 tokens (gemini-3.7-flash)"`. Sin este `coalesce`, medio historial de un canal con
 * antiguedad se agruparia bajo "sin especificar" y la grafica de costo por modelo no diria nada.
 *
 * Las barras van dobles porque esto es una plantilla de TypeScript: un `\(` suelto se escapa a `(`
 * antes de llegar a Postgres, que lo leeria como un grupo de captura en vez de como un parentesis
 * literal — y entonces la expresion devuelve el `detail` entero. Con eso, un item de TTS cuyo
 * detalle es "9 escenas" acababa apareciendo en la grafica como si fuera el nombre de un modelo.
 */
const itemModel = sql`coalesce(item.model, substring(item.detail from '\\(([^)]+)\\)$'))`;

/** El tipo de cambio guardado en la version; si esa version es vieja y no lo trae, el default. */
const rate = sql`coalesce(vv.exchange_rate_used::double precision, ${DEFAULT_USD_TO_MXN_RATE}::double precision)`;

export interface CostByModelRow {
  providerType: ProviderKind;
  providerName: string;
  /** Null en versiones renderizadas antes de que los costos guardaran el modelo. */
  model: string | null;
  isLocal: boolean;
  usd: number;
  mxn: number;
  /** Tokens (IA), caracteres (TTS) o clips (stock) consumidos en total. */
  units: number;
  unitKind: CostUnitKind | null;
  /** Cuantas llamadas cobradas — no cuantos videos. */
  calls: number;
  videos: number;
}

/**
 * Gasto agrupado por modelo concreto, que es la unidad en la que se decide: cambiar de
 * `gemini-3.7-flash` a `gemini-3.1-pro` es una decision de costo, cambiar de "Gemini" a "Gemini" no.
 *
 * Se agrupa por (tipo, proveedor, modelo) y no solo por modelo porque el mismo nombre de modelo
 * puede existir en dos proveedores, y porque la UI separa texto (`ai`) de voz (`tts`).
 */
export async function getCostByModel(): Promise<CostByModelRow[]> {
  const result = await db.execute<{
    provider_type: ProviderKind;
    provider_name: string;
    model: string | null;
    is_local: boolean;
    usd: number;
    mxn: number;
    units: number;
    unit_kind: CostUnitKind | null;
    calls: number;
    videos: number;
  }>(sql`
    select
      item."providerType"                          as provider_type,
      item."providerName"                          as provider_name,
      ${itemModel}                                 as model,
      bool_and(coalesce(item."isLocal", false))    as is_local,
      sum(coalesce(item."amountUsd", 0))           as usd,
      sum(coalesce(item."amountUsd", 0) * ${rate}) as mxn,
      sum(coalesce(item.units, 0))                 as units,
      max(item."unitKind")                         as unit_kind,
      count(*)::int                                as calls,
      count(distinct vv.video_id)::int             as videos
    ${costItems}
    group by 1, 2, 3
    order by usd desc, calls desc
  `);

  return result.rows.map((r) => ({
    providerType: r.provider_type,
    providerName: r.provider_name,
    model: r.model,
    isLocal: r.is_local,
    usd: Number(r.usd),
    mxn: Number(r.mxn),
    units: Number(r.units),
    unitKind: r.unit_kind,
    calls: r.calls,
    videos: r.videos,
  }));
}

export interface CostByStageRow {
  stage: CostStage;
  usd: number;
  mxn: number;
  videos: number;
}

/** En que etapa del pipeline se va el dinero, sobre todo el canal. */
export async function getCostByStage(): Promise<CostByStageRow[]> {
  const result = await db.execute<{ stage: CostStage; usd: number; mxn: number; videos: number }>(sql`
    select
      item.stage                                   as stage,
      sum(coalesce(item."amountUsd", 0))           as usd,
      sum(coalesce(item."amountUsd", 0) * ${rate}) as mxn,
      count(distinct vv.video_id)::int             as videos
    ${costItems}
    group by 1
    order by usd desc
  `);
  return result.rows.map((r) => ({ stage: r.stage, usd: Number(r.usd), mxn: Number(r.mxn), videos: r.videos }));
}

export interface CostByMonthRow {
  /** Primer dia del mes, en UTC. */
  month: Date;
  usd: number;
  mxn: number;
  videos: number;
  versions: number;
}

/**
 * Gasto por mes. Sale de los totales ya guardados en la version (`cost_total_usd`), no de volver a
 * sumar el jsonb: el total es una foto historica del costo al momento del render y es justo lo que
 * se quiere graficar en una serie de tiempo.
 */
export async function getCostByMonth(months = 12): Promise<CostByMonthRow[]> {
  const result = await db.execute<{ month: Date; usd: number; mxn: number; videos: number; versions: number }>(sql`
    select
      date_trunc('month', vv.created_at)                                             as month,
      sum(coalesce(vv.cost_total_usd::double precision, 0))              as usd,
      sum(coalesce(vv.cost_total_mxn::double precision, 0))              as mxn,
      count(distinct vv.video_id)::int                                               as videos,
      count(*)::int                                                                  as versions
    from video_versions vv
    where vv.created_at >= date_trunc('month', now()) - make_interval(months => ${months - 1}::int)
    group by 1
    order by 1
  `);
  return result.rows.map((r) => ({
    month: new Date(r.month),
    usd: Number(r.usd),
    mxn: Number(r.mxn),
    videos: r.videos,
    versions: r.versions,
  }));
}

export interface CostTotals {
  usd: number;
  mxn: number;
  videosWithCost: number;
  versions: number;
  /** Videos que llegaron a renderizarse alguna vez — el divisor del costo medio. */
  avgUsdPerVideo: number;
}

export async function getCostTotals(): Promise<CostTotals> {
  const result = await db.execute<{ usd: number; mxn: number; videos: number; versions: number }>(sql`
    select
      sum(coalesce(vv.cost_total_usd::double precision, 0)) as usd,
      sum(coalesce(vv.cost_total_mxn::double precision, 0)) as mxn,
      count(distinct vv.video_id)::int                                  as videos,
      count(*)::int                                                     as versions
    from video_versions vv
  `);
  const row = result.rows[0];
  const usd = Number(row?.usd ?? 0);
  const videos = row?.videos ?? 0;
  return {
    usd,
    mxn: Number(row?.mxn ?? 0),
    videosWithCost: videos,
    versions: row?.versions ?? 0,
    avgUsdPerVideo: videos > 0 ? usd / videos : 0,
  };
}

export interface CostEfficiencyRow {
  videoId: string;
  title: string | null;
  usd: number;
  views: number;
  /** Lo unico comparable entre un video de hace un ano y uno de la semana pasada. */
  usdPerThousandViews: number | null;
}

/**
 * Costo contra vistas, por video: la respuesta a "¿este gasto rindio?".
 *
 * Las dos mitades se agregan por separado DENTRO de la consulta (el costo desde `video_versions`,
 * las vistas desde el ultimo snapshot de cada video) y se unen al final. Hacerlo con dos consultas
 * y un join en JS costaria lo mismo en la base pero traeria dos listas completas para cruzarlas a
 * mano; asi solo vuelven las `limit` filas que se van a dibujar.
 *
 * Los videos sin vistas medidas van al final: no se pueden calificar todavia, pero tampoco se
 * pueden esconder — la pantalla dice cuantos son y por que faltan.
 */
export async function getCostEfficiency(limit = 20): Promise<CostEfficiencyRow[]> {
  const result = await db.execute<{
    video_id: string;
    title: string | null;
    usd: number;
    views: number;
  }>(sql`
    with cost as (
      select video_id, sum(coalesce(cost_total_usd::double precision, 0)) as usd
      from video_versions
      group by video_id
    ),
    latest as (
      select distinct on (vs.published_video_id)
        pv.video_id,
        coalesce(vs.engaged_views, vs.views, 0) as views
      from video_stats vs
      join published_videos pv on pv.id = vs.published_video_id
      where pv.status = 'published'
      order by vs.published_video_id, vs.captured_at desc
    )
    select v.id as video_id, v.title, coalesce(cost.usd, 0) as usd, coalesce(latest.views, 0) as views
    from videos v
    join cost on cost.video_id = v.id
    left join latest on latest.video_id = v.id
    -- Ordenado por la MISMA cifra que se grafica (costo por mil vistas, de menor a mayor). Cortar
    -- por costo absoluto y reordenar despues en JS daria un "top" enganoso: dejaria fuera al video
    -- barato que nadie vio, que es justamente el mas ineficiente de todos.
    order by
      case when coalesce(latest.views, 0) > 0 then cost.usd / latest.views end asc nulls last,
      cost.usd desc
    limit ${limit}
  `);

  return result.rows.map((r) => {
    const usd = Number(r.usd);
    const views = Number(r.views);
    return {
      videoId: r.video_id,
      title: r.title,
      usd,
      views,
      usdPerThousandViews: views > 0 ? (usd / views) * 1000 : null,
    };
  });
}
