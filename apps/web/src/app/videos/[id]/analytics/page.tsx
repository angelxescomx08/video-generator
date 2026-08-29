import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  costItemLabel,
  effectiveUnitPrice,
  formatBucket,
  getVideoAnalytics,
  resolveTimeRange,
  GRANULARITY_NOUNS,
  UNIT_LABELS,
  type TimeRange,
  type VideoAnalytics,
} from "@video-generator/analytics";
import type { CostItem, CostStage, CostUnitKind, RetentionPoint } from "@video-generator/types";
import { ChartFrame } from "@/components/charts/chart-frame";
import { BarChart, CompositionBar } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { ColumnChart } from "@/components/charts/column-chart";
import { Funnel } from "@/components/charts/funnel";
import { TimeControls } from "@/components/charts/time-controls";
import { HeroNumber, StatTile } from "@/components/charts/stat-tile";
import { compactNumber, formatMxn, formatPercent, formatUsd } from "@/components/charts/scales";
import { CostDisclaimer } from "@/components/cost-disclaimer";
import { STAGE_LABELS, summarizeVersionCosts } from "@/lib/version-costs";
import { withOverHundredNote } from "@/lib/retention-copy";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const FALLBACK_RATE = 18.5;

export default async function VideoAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const time = resolveTimeRange(query, { granularity: "day", range: "90d" });
  const data = await getVideoAnalytics(id, time);
  if (!data) notFound();

  const { video, published, latest, series, channel } = data;

  return (
    <div className="max-w-4xl space-y-10">
      <header className="space-y-3">
        <Link
          href={`/videos/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver al video
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Analiticas del video</h1>
            <p className="text-sm text-muted-foreground">{video.title ?? "Video sin titulo"}</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href={`/videos/${id}/performance`} className="text-muted-foreground underline hover:text-foreground">
              Capturar datos a mano
            </Link>
            {published?.externalUrl && (
              <a
                href={published.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                Abrir en YouTube
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Cada grafica trae un desplegable <span className="font-medium text-foreground">Como se lee</span> con
          lo que significa y que hacer con ella.
        </p>
      </header>

      {!published && <NotLinked videoId={id} />}

      {latest ? (
        <>
          <Overview latest={latest} channel={channel} capturedAt={latest.capturedAt} />
          <VideoFunnel latest={latest} />
          <RetentionCurveChart curve={latest.retentionCurve} avgViewPercentage={latest.avgViewPercentage} />

          <section className="space-y-4">
            <div className="border-b border-border pb-2">
              <h2 className="text-lg font-semibold">Evolucion en el tiempo</h2>
              <p className="text-sm text-muted-foreground">
                El periodo y la agrupacion mandan sobre las tres graficas de esta seccion.
              </p>
            </div>
            <TimeControls basePath={`/videos/${id}/analytics`} current={time} />
            <NewViewsChart series={series} time={time} />
            <CumulativeViewsChart series={series} time={time} />
            <QualityChart series={series} time={time} />
          </section>

          <TrafficChart sources={latest.trafficSources} />
        </>
      ) : (
        published && (
          <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            El video esta vinculado pero todavia no se ha capturado ninguna estadistica. La sincronizacion
            automatica corre cada 6 horas; tambien puedes forzarla desde{" "}
            <Link href="/analytics" className="underline">
              Analytics
            </Link>
            .
          </p>
        )
      )}

      <CostSection data={data} />
    </div>
  );
}

function NotLinked({ videoId }: { videoId: string }) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/40 p-4">
      <p className="text-sm font-medium">Este video no esta vinculado a YouTube</p>
      <p className="text-xs text-muted-foreground">
        Sin vinculo no hay de donde traer vistas ni retencion, asi que solo se puede ver el costo de
        produccion.{" "}
        <Link href={`/videos/${videoId}/performance`} className="underline">
          Vincularlo o capturar los datos a mano
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * El numero grande, y a su lado las metricas que importan CONTRA el promedio del canal.
 *
 * Un 38% de retencion no se puede juzgar solo: la comparacion con el resto del canal es lo que lo
 * convierte en "este gancho funciono" o "este gancho fallo". Por eso cada casilla trae su delta.
 */
function Overview({
  latest,
  channel,
  capturedAt,
}: {
  latest: NonNullable<VideoAnalytics["latest"]>;
  channel: VideoAnalytics["channel"];
  capturedAt: Date;
}) {
  const views = latest.engagedViews ?? latest.views ?? 0;

  return (
    <section className="space-y-5">
      <HeroNumber
        label="Vistas"
        value={compactNumber(views)}
        hint={`Ultima captura: ${capturedAt.toLocaleString("es-MX")}${
          latest.videoAgeDays === null ? "" : ` · ${latest.videoAgeDays} dias publicado`
        }`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Retencion a los 3s"
          value={formatPercent(latest.retentionAtStartPercentage)}
          delta={delta(latest.retentionAtStartPercentage, channel.avgRetentionAtStart, "la media del canal")}
          hint={withOverHundredNote("La nota del gancho.", latest.retentionAtStartPercentage)}
        />
        <StatTile
          label="Porcentaje visto"
          value={formatPercent(latest.avgViewPercentage)}
          delta={delta(latest.avgViewPercentage, channel.avgViewPercentage, "la media del canal")}
          hint={withOverHundredNote("La nota del guion completo.", latest.avgViewPercentage)}
        />
        <StatTile
          label="CTR de impresiones"
          value={formatPercent(latest.impressionsCtr)}
          delta={delta(latest.impressionsCtr, channel.avgCtr, "la media del canal")}
          hint="La nota del titulo y la miniatura."
        />
        <StatTile
          label="Suscriptores ganados"
          value={latest.subscribersGained === null ? "—" : compactNumber(latest.subscribersGained)}
          hint="La senal de calidad mas honesta que da YouTube."
        />
        <StatTile
          label="Duracion media vista"
          value={latest.avgViewDurationSeconds === null ? "—" : `${Math.round(latest.avgViewDurationSeconds)}s`}
        />
        <StatTile
          label="Horas de reproduccion"
          value={latest.watchTimeHours === null ? "—" : latest.watchTimeHours.toFixed(1)}
        />
        <StatTile label="Likes" value={latest.likes === null ? "—" : compactNumber(latest.likes)} />
        <StatTile label="Comentarios" value={latest.comments === null ? "—" : compactNumber(latest.comments)} />
      </div>
    </section>
  );
}

/** Sin referencia con la que comparar, no se dibuja un delta: un "+0" inventado enganaria. */
function delta(value: number | null, reference: number | null, label: string) {
  if (value === null || reference === null) return undefined;
  return { points: value - reference, label, upIsGood: true };
}

function VideoFunnel({ latest }: { latest: NonNullable<VideoAnalytics["latest"]> }) {
  const impressions = latest.impressions ?? 0;
  const views = latest.views ?? 0;
  const engaged = latest.engagedViews ?? 0;
  const subs = latest.subscribersGained ?? 0;

  return (
    <ChartFrame
      title="El embudo de este video"
      description="Cuanta gente sobrevive a cada paso, desde que YouTube lo ensena hasta que alguien se suscribe."
      howToRead={{
        measures:
          "Las cuatro etapas por las que pasa un espectador de ESTE video: impresion, vista, permanencia mas alla de los primeros segundos y suscripcion.",
        read: "El porcentaje que sobrevive de un escalon al siguiente localiza el fallo. La caida mas grande es el problema del video.",
        act: "Impresiones a vistas flojo = titulo o miniatura. Vistas a permanencia flojo = gancho. Permanencia buena sin suscriptores = entretiene pero no da razones para volver.",
        source: "Ultima captura. En Shorts, YouTube no reporta impresiones: ese escalon sale como 'sin dato', que no es cero.",
      }}
      isEmpty={views === 0 && impressions === 0}
      empty="Todavia no hay vistas medidas para este video."
      table={{
        columns: ["Etapa", "Total"],
        rows: [
          ["Impresiones", impressions.toLocaleString("es-MX")],
          ["Vistas", views.toLocaleString("es-MX")],
          ["Vistas con permanencia", engaged.toLocaleString("es-MX")],
          ["Suscriptores ganados", subs.toLocaleString("es-MX")],
        ],
      }}
    >
      <Funnel
        steps={[
          { label: "Impresiones", value: impressions, help: "Veces que YouTube mostro la miniatura." },
          { label: "Vistas", value: views, help: "Veces que alguien abrio el video." },
          {
            label: "Vistas con permanencia",
            value: engaged,
            help: "Se quedaron mas alla de los primeros segundos. Es el tamano de muestra real.",
          },
          { label: "Suscriptores ganados", value: subs, help: "Se suscribieron despues de ver este video." },
        ]}
      />
    </ChartFrame>
  );
}

/**
 * La curva de retencion: donde exactamente se cae la audiencia.
 *
 * Es la grafica mas util del producto — el punto en el que la linea se desploma es el segundo del
 * guion que hay que reescribir. El eje X va en porcentaje del video y no en segundos porque es lo
 * que devuelve la API de YouTube, y asi ademas dos videos de duracion distinta se pueden comparar.
 */
function RetentionCurveChart({
  curve,
  avgViewPercentage,
}: {
  curve: RetentionPoint[] | null;
  avgViewPercentage: number | null;
}) {
  const points = (curve ?? []).slice().sort((a, b) => a.elapsedRatio - b.elapsedRatio);

  return (
    <ChartFrame
      title="Curva de retencion"
      description={`Que porcentaje de la audiencia seguia viendo en cada punto del video.${
        avgViewPercentage === null ? "" : ` En promedio se vio el ${avgViewPercentage.toFixed(1)}% del video.`
      }`}
      howToRead={{
        measures:
          "El eje horizontal es el video de principio a fin, en porcentaje de su duracion. El vertical, cuanta audiencia seguia viendo en ese punto.",
        read: "Busca la CAIDA MAS BRUSCA, no el nivel general. Un desplome en los primeros tramos es un gancho que no cumple lo que promete; una pendiente suave y constante es normal; una subida al final significa que la gente lo repite.",
        act: "Multiplica el porcentaje donde cae por la duracion del video y tendras el segundo exacto. Abre el guion en ese segundo: eso es lo que hay que cortar o reescribir.",
        source:
          "YouTube publica la curva ~48h despues de subir el video y necesita un minimo de reproducciones. En Shorts los valores pasan de 100 porque cuentan las repeticiones.",
      }}
      isEmpty={points.length < 2}
      empty="YouTube todavia no publica la curva de este video. Suele tardar unas 48 horas desde la subida, y necesita un minimo de reproducciones."
      table={{
        columns: ["Punto del video", "Seguian viendo"],
        rows: points.map((p) => [`${(p.elapsedRatio * 100).toFixed(0)}%`, `${(p.watchRatio * 100).toFixed(1)}%`]),
      }}
    >
      <LineChart
        labels={points.map((p) => `${Math.round(p.elapsedRatio * 100)}%`)}
        format={(v) => `${Math.round(v)}%`}
        minAxisTop={100}
        series={[{ label: "Seguian viendo", values: points.map((p) => p.watchRatio * 100), area: true }]}
      />
    </ChartFrame>
  );
}

function NewViewsChart({ series, time }: { series: VideoAnalytics["series"]; time: TimeRange }) {
  const noun = GRANULARITY_NOUNS[time.granularity];
  const values = series.map((b) => b.newViews);

  return (
    <ChartFrame
      title={`Vistas nuevas por ${noun}`}
      description={`Cuantas vistas gano este video en cada ${noun}.`}
      howToRead={{
        measures: `La diferencia entre las vistas totales al cerrar un ${noun} y las del ${noun} anterior.`,
        read: "Es la grafica que dice si el video sigue vivo. Barras altas al principio que caen a casi nada es el ciclo normal de un Short; barras que se mantienen significan que YouTube lo sigue distribuyendo.",
        act: "Si las barras se apagaron hace tiempo, este video ya dio lo que tenia que dar: las decisiones se toman con los videos que aun se mueven.",
        source: `El primer ${noun} sale vacio: no hay periodo anterior contra el que restar.`,
      }}
      isEmpty={values.filter((v) => v !== null).length === 0}
      empty={`Hacen falta capturas en al menos dos ${noun}s consecutivos para poder restar uno del otro.`}
      table={{
        columns: [noun, "Vistas nuevas", "Acumuladas", "Likes nuevos"],
        rows: series.map((b) => [
          formatBucket(b.bucket, time.granularity),
          b.newViews === null ? "—" : b.newViews.toLocaleString("es-MX"),
          b.cumulativeViews.toLocaleString("es-MX"),
          b.newLikes === null ? "—" : b.newLikes.toLocaleString("es-MX"),
        ]),
      }}
    >
      <ColumnChart
        labels={series.map((b) => formatBucket(b.bucket, time.granularity))}
        values={values}
        valueLabel="vistas nuevas"
      />
    </ChartFrame>
  );
}

function CumulativeViewsChart({ series, time }: { series: VideoAnalytics["series"]; time: TimeRange }) {
  return (
    <ChartFrame
      title="Vistas acumuladas"
      description="El contador total del video al cerrar cada periodo. Solo puede subir."
      howToRead={{
        measures: "El contador de vistas que reporta YouTube, que es acumulado desde la publicacion.",
        read: "Lo que se lee es la PENDIENTE. Una curva que arranca vertical y se tumba es el ciclo tipico; un tramo plano al final significa que salio de distribucion.",
        act: "Si se tumbo muy pronto pese a tener buena retencion, el problema no fue el video sino que YouTube dejo de ensenarlo — mira el CTR y las fuentes de trafico.",
        source: "Se toma la ultima captura de cada periodo, nunca la suma: sumarlas contaria el mismo video varias veces.",
      }}
      isEmpty={series.length < 2}
      empty="Hace falta mas de un periodo con capturas para dibujar una evolucion."
      table={{
        columns: [GRANULARITY_NOUNS[time.granularity], "Vistas acumuladas", "Likes"],
        rows: series.map((b) => [
          formatBucket(b.bucket, time.granularity),
          b.cumulativeViews.toLocaleString("es-MX"),
          b.likes.toLocaleString("es-MX"),
        ]),
      }}
    >
      <LineChart
        labels={series.map((b) => formatBucket(b.bucket, time.granularity))}
        series={[{ label: "Vistas acumuladas", values: series.map((b) => b.cumulativeViews), area: true }]}
      />
    </ChartFrame>
  );
}

/**
 * Retencion y porcentaje visto en el mismo plano.
 *
 * Comparten eje porque comparten unidad (ambos son porcentajes), que es la unica condicion bajo la
 * que dos series pueden convivir en una grafica. Las vistas, que estan en otra escala, van aparte:
 * meterlas aqui con un segundo eje inventaria una correlacion que no se midio.
 */
function QualityChart({ series, time }: { series: VideoAnalytics["series"]; time: TimeRange }) {
  const hasData = series.some((b) => b.retentionAtStart !== null || b.avgViewPercentage !== null);

  return (
    <ChartFrame
      title="Evolucion de la calidad"
      description="Retencion y porcentaje visto, periodo a periodo."
      howToRead={{
        measures:
          "Las dos notas del video a lo largo del tiempo: cuantos aguantan los primeros segundos y que porcentaje del video se ve de media. Las dos son porcentajes, por eso comparten eje.",
        read: "Suelen BAJAR con el tiempo, y eso es normal: al ampliar la distribucion, YouTube ensena el video a publico menos afin. Lo relevante es si la caida es suave o si se desploma.",
        act: "Un desplome sostenido explica que el video deje de recomendarse: el algoritmo mide lo mismo que tu estas viendo aqui.",
        source: "Ultima captura de cada periodo. Los huecos son periodos sin sincronizacion, no ceros.",
      }}
      series={[
        { label: "Retencion 3s", color: "var(--chart-1)" },
        { label: "Porcentaje visto", color: "var(--chart-2)" },
      ]}
      isEmpty={!hasData || series.length < 2}
      empty="Todavia no hay suficientes capturas con retencion medida."
      table={{
        columns: [GRANULARITY_NOUNS[time.granularity], "Retencion 3s", "Porcentaje visto", "CTR"],
        rows: series.map((b) => [
          formatBucket(b.bucket, time.granularity),
          formatPercent(b.retentionAtStart),
          formatPercent(b.avgViewPercentage),
          formatPercent(b.ctr),
        ]),
      }}
    >
      <LineChart
        labels={series.map((b) => formatBucket(b.bucket, time.granularity))}
        minAxisTop={100}
        format={(v) => `${Math.round(v)}%`}
        series={[
          { label: "Retencion 3s", values: series.map((b) => b.retentionAtStart) },
          { label: "Porcentaje visto", values: series.map((b) => b.avgViewPercentage) },
        ]}
      />
    </ChartFrame>
  );
}

/** Los codigos que devuelve la API de YouTube no son legibles; esto los traduce. */
const TRAFFIC_LABELS: Record<string, string> = {
  SHORTS: "Feed de Shorts",
  SUBSCRIBER: "Pagina de inicio / suscriptores",
  YT_SEARCH: "Busqueda de YouTube",
  SUGGESTED_VIDEO: "Videos sugeridos",
  RELATED_VIDEO: "Videos relacionados",
  BROWSE: "Funciones de exploracion",
  PLAYLIST: "Listas de reproduccion",
  EXT_URL: "Sitios externos",
  NOTIFICATION: "Notificaciones",
  YT_CHANNEL: "Pagina del canal",
  NO_LINK_OTHER: "Directo o desconocido",
  ADVERTISING: "Anuncios",
};

function TrafficChart({ sources }: { sources: Record<string, number> | null }) {
  const rows = Object.entries(sources ?? {})
    .map(([key, value]) => ({ label: TRAFFIC_LABELS[key] ?? key, value: Number(value) || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <ChartFrame
      title="De donde vinieron las vistas"
      description="Reparto de las vistas por la superficie de YouTube que las trajo."
      howToRead={{
        measures: "Cuantas vistas llegaron desde cada sitio: el feed de Shorts, la busqueda, los sugeridos, los suscriptores...",
        read: "Dice a que atribuir el resultado. Un video que vive del feed de Shorts se juega todo en el gancho; uno que vive de la busqueda se lo juega en el titulo; uno que vive de suscriptores no esta llegando a gente nueva.",
        act: "Si casi todo viene de suscriptores, el video no esta creciendo el canal aunque tenga buenos numeros: gustó a los de siempre.",
        source: "Requiere permisos de YouTube Analytics y un minimo de vistas. Si falta, YouTube no lo devolvio para este video.",
      }}
      isEmpty={rows.length === 0}
      empty="YouTube no devolvio el reparto por fuente de trafico para este video. Requiere permisos de Analytics y un minimo de vistas."
      table={{
        columns: ["Fuente", "Vistas", "Peso"],
        rows: rows.map((r) => [
          r.label,
          r.value.toLocaleString("es-MX"),
          `${total > 0 ? ((r.value / total) * 100).toFixed(1) : "0"}%`,
        ]),
      }}
    >
      <BarChart
        rows={rows.map((r) => ({
          label: r.label,
          value: r.value,
          display: compactNumber(r.value),
          note: total > 0 ? `${((r.value / total) * 100).toFixed(0)}% de las vistas` : undefined,
        }))}
      />
    </ChartFrame>
  );
}

/**
 * El costo de este video: en que etapa se fue, con que modelo, y si se convirtio en vistas.
 *
 * Se agrega en memoria y no en SQL porque aqui el conjunto es un solo video — a lo sumo unas pocas
 * versiones con cinco items cada una. La agregacion en base de datos es para las pantallas globales,
 * donde el conjunto es todo el canal.
 */
function CostSection({ data }: { data: VideoAnalytics }) {
  const { versions, latest } = data;
  const summary = summarizeVersionCosts(
    versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      costBreakdown: v.costBreakdown,
      costTotalUsd: v.costTotalUsd,
      costTotalMxn: v.costTotalMxn,
      exchangeRateUsed: v.exchangeRateUsed,
    })),
    FALLBACK_RATE,
  );

  const items = versions.flatMap((v) => v.costBreakdown ?? []);
  if (items.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Costo de produccion</h2>
        <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Este video todavia no tiene un desglose de costo guardado. Se calcula y se congela al terminar el
          render de cada version.
        </p>
      </section>
    );
  }

  const byStage = sumByStage(items);
  const byModel = groupByModel(items);
  const views = latest?.engagedViews ?? latest?.views ?? 0;
  const rate = summary.totalUsd > 0 ? summary.totalMxn / summary.totalUsd : FALLBACK_RATE;
  const perThousand = views > 0 ? (summary.totalUsd / views) * 1000 : null;

  return (
    <section className="space-y-5">
      <div className="border-b border-border pb-2">
        <h2 className="text-lg font-semibold">Costo de produccion</h2>
        <p className="text-sm text-muted-foreground">
          Suma de las {versions.length} version(es) de este video. Las etapas que se reutilizaron entre
          versiones no se volvieron a pagar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Costo total" value={formatUsd(summary.totalUsd)} hint={formatMxn(summary.totalMxn)} />
        <StatTile
          label="Costo por 1000 vistas"
          value={perThousand === null ? "—" : formatUsd(perThousand)}
          hint={views > 0 ? `Sobre ${compactNumber(views)} vistas.` : "Hacen falta vistas medidas."}
        />
        <StatTile
          label="Ahorrado reutilizando"
          value={formatUsd(summary.totalSavedUsd)}
          hint="Lo que habria costado regenerar guion, voz y clips en cada version en vez de solo re-renderizar."
        />
        <StatTile label="Versiones" value={String(versions.length)} />
      </div>

      <ChartFrame
        title="En que se fue el dinero"
        description="Reparto entre las etapas del pipeline, sumando todas las versiones."
        howToRead={{
          measures: "El costo de este video partido por etapa: guion, voz, video de stock, edicion y render.",
          read: "Una sola barra al 100%: lo que se lee es la proporcion. En este pipeline la voz suele ser el bloque dominante porque se cobra por caracter y los guiones son largos.",
          act: "Si quieres abaratar este tipo de video, el bloque mas ancho es el unico sitio donde tocar algo se nota.",
          source: "Desglose congelado al renderizar cada version. Las etapas gratuitas salen en cero.",
        }}
        isEmpty={[...byStage.values()].every((v) => v === 0)}
        empty="Todas las etapas de este video corrieron con proveedores gratuitos."
        table={{
          columns: ["Etapa", "USD", "MXN"],
          rows: [...byStage.entries()].map(([stage, usd]) => [
            STAGE_LABELS[stage] ?? stage,
            formatUsd(usd),
            formatMxn(usd * rate),
          ]),
        }}
      >
        <CompositionBar
          format={formatUsd}
          segments={[...byStage.entries()].map(([stage, usd]) => ({
            label: STAGE_LABELS[stage] ?? stage,
            value: usd,
          }))}
        />
      </ChartFrame>

      <ModelBreakdown rows={byModel} rate={rate} />

      <VersionTimeline summary={summary} />

      <CostDisclaimer />
    </section>
  );
}

interface ModelRow {
  label: string;
  usd: number;
  units: number;
  unitKind: CostUnitKind | null;
  isLocal: boolean;
}

/** Un renglon por modelo/voz usado en este video, con su consumo — texto y voz mezclados a proposito:
 * la pregunta aqui es "que se uso para hacer ESTE video", no "que modelo es mas barato en general". */
function groupByModel(items: CostItem[]): ModelRow[] {
  const map = new Map<string, ModelRow>();
  for (const item of items) {
    const label = costItemLabel(item);
    const existing =
      map.get(label) ?? { label, usd: 0, units: 0, unitKind: item.unitKind ?? null, isLocal: item.isLocal };
    existing.usd += item.amountUsd;
    existing.units += item.units ?? 0;
    existing.unitKind = existing.unitKind ?? item.unitKind ?? null;
    map.set(label, existing);
  }
  return [...map.values()].sort((a, b) => b.usd - a.usd);
}

function ModelBreakdown({ rows, rate }: { rows: ModelRow[]; rate: number }) {
  const paid = rows.filter((r) => r.usd > 0);
  const free = rows.filter((r) => r.usd === 0);

  return (
    <ChartFrame
      title="Modelos y voces usados"
      description="Lo que cobro cada modelo de texto y cada voz en este video."
      howToRead={{
        measures: "El gasto de cada modelo en este video, con el consumo que lo explica (tokens en texto, caracteres en voz).",
        read: "Compara el consumo, no solo el gasto: un guion mas largo sube los caracteres y por tanto la factura de la voz sin que nada haya cambiado de precio.",
        act: "Si un modelo domina el costo de todos tus videos, la pantalla de Costos tiene su precio efectivo por millon de unidades para decidir si vale la pena cambiarlo.",
        source: "Consumo reportado por cada proveedor por la tabla de precios del repositorio. En videos viejos el modelo puede aparecer como el nombre del proveedor.",
      }}
      isEmpty={paid.length === 0}
      empty={
        free.length > 0
          ? `Este video se produjo entero con proveedores gratuitos: ${free.map((r) => r.label).join(", ")}.`
          : "Sin modelos de pago registrados."
      }
      table={{
        columns: ["Modelo / voz", "USD", "MXN", "Consumo", "Precio efectivo"],
        rows: rows.map((r) => {
          const unitPrice = effectiveUnitPrice(r.usd, r.units, r.unitKind);
          return [
            r.label + (r.isLocal ? " (local)" : ""),
            formatUsd(r.usd),
            formatMxn(r.usd * rate),
            r.units > 0 && r.unitKind ? `${compactNumber(r.units)} ${UNIT_LABELS[r.unitKind].plural}` : "—",
            unitPrice === null || !r.unitKind ? "—" : `${formatUsd(unitPrice)} ${UNIT_LABELS[r.unitKind].per}`,
          ];
        }),
      }}
    >
      <BarChart
        format={formatUsd}
        rows={paid.map((r) => ({
          label: r.label,
          value: r.usd,
          display: formatUsd(r.usd),
          note: r.units > 0 && r.unitKind ? `${compactNumber(r.units)} ${UNIT_LABELS[r.unitKind].plural}` : undefined,
        }))}
      />
    </ChartFrame>
  );
}

/** El historial de versiones en clave de costo: que se pago de nuevo y que se heredo. */
function VersionTimeline({ summary }: { summary: ReturnType<typeof summarizeVersionCosts> }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Version a version</h3>
      <p className="text-xs text-muted-foreground">
        Cada version solo paga las etapas que de verdad se volvieron a correr: cambiar la musica re-renderiza
        pero no vuelve a comprar guion ni voz.
      </p>
      <ul className="space-y-2">
        {summary.perVersion.map((version) => (
          <li
            key={version.versionId}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-xs"
          >
            <Badge variant="outline" className="text-[10px]">
              v{version.versionNumber}
            </Badge>
            <span className="tabular-nums">{formatUsd(version.newCostUsd)}</span>
            <span className="text-muted-foreground">
              pago {version.paidStages.map((s) => STAGE_LABELS[s] ?? s).join(", ") || "nada"}
            </span>
            {version.reusedStages.length > 0 && (
              <span className="text-muted-foreground">
                · reutilizo {version.reusedStages.map((s) => STAGE_LABELS[s] ?? s).join(", ")} (
                {formatUsd(version.savedUsd)} ahorrados)
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function sumByStage(items: CostItem[]): Map<CostStage, number> {
  const map = new Map<CostStage, number>();
  for (const item of items) {
    map.set(item.stage, (map.get(item.stage) ?? 0) + item.amountUsd);
  }
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
}
