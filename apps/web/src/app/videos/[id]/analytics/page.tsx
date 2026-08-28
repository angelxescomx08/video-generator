import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  costItemLabel,
  effectiveUnitPrice,
  getVideoAnalytics,
  UNIT_LABELS,
  type VideoAnalytics,
} from "@video-generator/analytics";
import type { CostItem, CostStage, CostUnitKind, RetentionPoint } from "@video-generator/types";
import { ChartFrame } from "@/components/charts/chart-frame";
import { BarChart, CompositionBar } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { HeroNumber, StatTile } from "@/components/charts/stat-tile";
import { compactNumber, formatDay, formatMxn, formatPercent, formatUsd } from "@/components/charts/scales";
import { CostDisclaimer } from "@/components/cost-disclaimer";
import { STAGE_LABELS, summarizeVersionCosts } from "@/lib/version-costs";
import { withOverHundredNote } from "@/lib/retention-copy";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const FALLBACK_RATE = 18.5;

export default async function VideoAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getVideoAnalytics(id);
  if (!data) notFound();

  const { video, published, latest, daily, channel } = data;

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
      </header>

      {!published && <NotLinked videoId={id} />}

      {latest ? (
        <>
          <Overview latest={latest} channel={channel} capturedAt={latest.capturedAt} />
          <RetentionCurveChart curve={latest.retentionCurve} avgViewPercentage={latest.avgViewPercentage} />
          <ViewsChart daily={daily} />
          <QualityChart daily={daily} />
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

function ViewsChart({ daily }: { daily: VideoAnalytics["daily"] }) {
  return (
    <ChartFrame
      title="Vistas acumuladas"
      description="Una lectura por dia (la ultima de ese dia). El tramo plano al final indica que el video salio de distribucion."
      isEmpty={daily.length < 2}
      empty="Hace falta mas de un dia de capturas para dibujar una evolucion."
      table={{
        columns: ["Dia", "Vistas", "Likes"],
        rows: daily.map((d) => [formatDay(d.day), d.views.toLocaleString("es-MX"), d.likes.toLocaleString("es-MX")]),
      }}
    >
      <LineChart
        labels={daily.map((d) => formatDay(d.day))}
        series={[{ label: "Vistas", values: daily.map((d) => d.views), area: true }]}
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
function QualityChart({ daily }: { daily: VideoAnalytics["daily"] }) {
  const hasData = daily.some((d) => d.retentionAtStart !== null || d.avgViewPercentage !== null);

  return (
    <ChartFrame
      title="Evolucion de la calidad"
      description="Retencion y porcentaje visto suelen bajar cuando YouTube amplia la distribucion a publico menos afin. Una caida sostenida ahi explica que el video deje de recomendarse."
      series={[
        { label: "Retencion 3s", color: "var(--chart-1)" },
        { label: "Porcentaje visto", color: "var(--chart-2)" },
      ]}
      isEmpty={!hasData || daily.length < 2}
      empty="Todavia no hay suficientes capturas con retencion medida."
      table={{
        columns: ["Dia", "Retencion 3s", "Porcentaje visto", "CTR"],
        rows: daily.map((d) => [
          formatDay(d.day),
          formatPercent(d.retentionAtStart),
          formatPercent(d.avgViewPercentage),
          formatPercent(d.ctr),
        ]),
      }}
    >
      <LineChart
        labels={daily.map((d) => formatDay(d.day))}
        minAxisTop={100}
        format={(v) => `${Math.round(v)}%`}
        series={[
          { label: "Retencion 3s", values: daily.map((d) => d.retentionAtStart) },
          { label: "Porcentaje visto", values: daily.map((d) => d.avgViewPercentage) },
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
      description="Dice a que hay que atribuir el resultado: un video que solo vive del feed de Shorts depende del gancho, y uno que vive de la busqueda depende del titulo."
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

  const byStage = sumBy(items, (i) => i.stage);
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
    const existing = map.get(label) ?? { label, usd: 0, units: 0, unitKind: item.unitKind ?? null, isLocal: item.isLocal };
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
      description="Lo que cobro cada modelo de texto y cada voz en este video, con el consumo que lo explica."
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
      <ul className="space-y-2">
        {summary.perVersion.map((version) => (
          <li key={version.versionId} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-xs">
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

function sumBy(items: CostItem[], key: (item: CostItem) => CostStage): Map<CostStage, number> {
  const map = new Map<CostStage, number>();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + item.amountUsd);
  }
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
}
