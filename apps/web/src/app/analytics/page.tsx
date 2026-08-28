import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { desc, inArray, notInArray } from "drizzle-orm";
import {
  getChannelOverview,
  getChannelViewsSeries,
  getLearningReadiness,
  getPerformanceLearnings,
  getPublicationTimeline,
  latestSnapshotPerVideo,
  getCostTotals,
  type LatestSnapshotRow,
  type PublicationPoint,
} from "@video-generator/analytics";
import type { PerformanceLearning } from "@video-generator/types";
import { db, publishedVideos, videos } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { SyncAllStatsButton } from "@/components/sync-all-stats-button";
import { ChartFrame } from "@/components/charts/chart-frame";
import { LineChart } from "@/components/charts/line-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { HeroNumber, StatTile } from "@/components/charts/stat-tile";
import { compactNumber, formatDay, formatPercent, formatUsd, movingAverage } from "@/components/charts/scales";
import { withOverHundredNote } from "@/lib/retention-copy";

export const dynamic = "force-dynamic";

/** Ventana de la serie de vistas. Acota el escaneo de `video_stats`, que crece sin techo. */
const VIEWS_WINDOW_DAYS = 90;

export default async function AnalyticsPage() {
  // Una sola ronda en paralelo. Encadenar estos `await` convertiria la pantalla en ocho viajes
  // secuenciales a la base antes de poder pintar el primer pixel.
  const [overview, latestStats, viewsSeries, timeline, learnings, readiness, costTotals, linked, unlinked] =
    await Promise.all([
      getChannelOverview(),
      latestSnapshotPerVideo(),
      getChannelViewsSeries(VIEWS_WINDOW_DAYS),
      getPublicationTimeline(),
      getPerformanceLearnings(),
      getLearningReadiness(),
      getCostTotals(),
      db.select().from(publishedVideos),
      unlinkedPublishableVideos(),
    ]);

  const usableLinks = linked.filter((l) => l.status === "published");
  const brokenLinks = linked.filter((l) => l.status === "failed");

  return (
    <div className="space-y-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Rendimiento del canal</h1>
        <p className="text-sm text-muted-foreground">
          Como le fue a cada video publicado y que ha aprendido la IA de eso. Se sincroniza solo cada 6 horas
          (job <code>poll-stats</code> del worker).
        </p>
      </div>

      <SyncAllStatsButton linkedCount={usableLinks.length} />

      {brokenLinks.length > 0 && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          {brokenLinks.length} video(s) tienen un vinculo de YouTube invalido y se estan omitiendo. Entra a
          su pantalla de rendimiento para corregirlo.
        </p>
      )}

      {overview.videosWithStats === 0 ? (
        <EmptyState hasLinks={usableLinks.length > 0} />
      ) : (
        <>
          <Overview overview={overview} costTotals={costTotals} />
          <ViewsChart series={viewsSeries} />
          <GrowthChart timeline={timeline} />
          <LearningsSection learnings={learnings} readiness={readiness} />
          <RetentionRanking rows={latestStats} />
          <StatsTable rows={latestStats} />
        </>
      )}

      {unlinked.length > 0 && <UnlinkedVideos videos={unlinked} />}
    </div>
  );
}

function Overview({
  overview,
  costTotals,
}: {
  overview: Awaited<ReturnType<typeof getChannelOverview>>;
  costTotals: Awaited<ReturnType<typeof getCostTotals>>;
}) {
  const costPerThousand =
    overview.totalViews > 0 ? (costTotals.usd / overview.totalViews) * 1000 : null;

  return (
    <section className="space-y-5">
      <HeroNumber
        label="Vistas del canal"
        value={compactNumber(overview.totalViews)}
        hint={`Suma de la ultima captura de ${overview.videosWithStats} video(s) publicado(s).`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Retencion a los 3s (media)"
          value={formatPercent(overview.avgRetentionAtStart)}
          hint={withOverHundredNote(
            "La nota del gancho: cuantos siguen ahi tras los primeros segundos.",
            overview.avgRetentionAtStart,
          )}
        />
        <StatTile
          label="Porcentaje visto (media)"
          value={formatPercent(overview.avgViewPercentage)}
          hint={withOverHundredNote("La nota del guion completo.", overview.avgViewPercentage)}
        />
        <StatTile
          label="CTR de impresiones (media)"
          value={formatPercent(overview.avgCtr)}
          hint="La nota del titulo y la miniatura. No existe en Shorts."
        />
        <StatTile
          label="Vistas medianas por video"
          value={overview.medianViews === null ? "—" : compactNumber(overview.medianViews)}
          hint="Mediana y no promedio: un video viral no debe hacer parecer que a todos les va bien."
        />
        <StatTile
          label="Suscriptores ganados"
          value={compactNumber(overview.totalSubscribers)}
          hint="La senal de calidad mas honesta que da YouTube."
        />
        <StatTile label="Likes" value={compactNumber(overview.totalLikes)} />
        <StatTile
          label="Costo de produccion"
          value={formatUsd(costTotals.usd)}
          hint={
            <>
              {formatUsd(costTotals.avgUsdPerVideo)} por video ·{" "}
              <Link href="/analytics/costs" className="underline">
                desglose
              </Link>
            </>
          }
        />
        <StatTile
          label="Costo por 1000 vistas"
          value={costPerThousand === null ? "—" : formatUsd(costPerThousand)}
          hint="Lo unico que compara de forma justa un video viejo con uno nuevo."
        />
      </div>
    </section>
  );
}

function ViewsChart({ series }: { series: Awaited<ReturnType<typeof getChannelViewsSeries>> }) {
  return (
    <ChartFrame
      title={`Vistas acumuladas del canal (${VIEWS_WINDOW_DAYS} dias)`}
      description="Suma de las vistas de todos los videos publicados en cada dia con sincronizacion. Sube en escalon cuando un video entra en distribucion."
      isEmpty={series.length < 2}
      empty="Hacen falta al menos dos dias de capturas para dibujar una evolucion. Sincroniza y vuelve manana."
      table={{
        columns: ["Dia", "Vistas", "Videos con captura"],
        rows: series.map((p) => [formatDay(p.day), p.views.toLocaleString("es-MX"), p.videos]),
      }}
    >
      <LineChart
        labels={series.map((p) => formatDay(p.day))}
        series={[{ label: "Vistas", values: series.map((p) => p.views), area: true }]}
      />
    </ChartFrame>
  );
}

/**
 * La grafica que responde a "¿estamos mejorando?".
 *
 * Se ordena por fecha de PUBLICACION, no de captura: la pregunta es si los videos hechos DESPUES de
 * aprender algo rinden mejor que los de antes. La nube de puntos es cada video y la linea es la
 * media movil, porque video a video la retencion salta demasiado para leer una direccion.
 */
function GrowthChart({ timeline }: { timeline: PublicationPoint[] }) {
  const usingRetention = timeline.filter((p) => p.retentionAtStart !== null).length >= 3;
  const values = timeline.map((p) => (usingRetention ? p.retentionAtStart : p.avgViewPercentage));
  const metric = usingRetention ? "Retencion a los 3s" : "Porcentaje visto";
  const trend = movingAverage(values, 5);

  return (
    <ChartFrame
      title="¿Estan mejorando los videos nuevos?"
      description={`${metric} de cada video, en orden de publicacion. Si el aprendizaje sirve, la linea de tendencia sube: los videos escritos despues de medir algo deberian retener mas que los de antes.`}
      series={[
        { label: `${metric} por video`, color: "var(--chart-1)" },
        { label: "Tendencia (media movil de 5)", color: "var(--chart-2)" },
      ]}
      isEmpty={values.filter((v) => v !== null).length < 3}
      empty="Hacen falta al menos 3 videos publicados con retencion medida para que una tendencia signifique algo."
      table={{
        columns: ["Publicado", "Video", metric, "Vistas"],
        rows: timeline.map((p, i) => [
          p.publishedAt.toLocaleDateString("es-MX"),
          p.title ?? "(sin titulo)",
          formatPercent(values[i]),
          p.views.toLocaleString("es-MX"),
        ]),
      }}
    >
      <LineChart
        labels={timeline.map((p) => formatDay(p.publishedAt))}
        minAxisTop={100}
        format={(v) => `${Math.round(v)}%`}
        series={[
          { label: `${metric} por video`, values, dotsOnly: true },
          { label: "Tendencia (media movil de 5)", values: trend },
        ]}
      />
    </ChartFrame>
  );
}

/**
 * Las lecciones que el motor de aprendizaje le esta pasando al prompt, dibujadas.
 *
 * Es la misma funcion que usa el worker al escribir el guion, no una copia: lo que se ve aqui es
 * literalmente lo que la IA esta leyendo. Por eso la comparacion se muestra con sus muestras — una
 * diferencia de 20 puntos entre grupos de 3 videos no es lo mismo que entre grupos de 40.
 */
function LearningsSection({
  learnings,
  readiness,
}: {
  learnings: PerformanceLearning[];
  readiness: Awaited<ReturnType<typeof getLearningReadiness>>;
}) {
  return (
    <section className="space-y-4">
      <div className="border-b border-border pb-2">
        <h2 className="text-lg font-semibold">Lo que la IA aprendio de los videos pasados</h2>
        <p className="text-sm text-muted-foreground">
          Patrones medidos sobre todo el canal, no sobre un tema. Estos textos entran tal cual en el prompt
          del siguiente guion.
        </p>
      </div>

      {learnings.length === 0 ? (
        <div className="space-y-1 rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Todavia no hay patrones que se sostengan</p>
          <p className="text-xs text-muted-foreground">
            {readiness.usableSamples} de {readiness.publishedVideos} video(s) publicados sirven como muestra
            (hacen falta {readiness.minViews}+ vistas y {readiness.minDays}+ dias publicados). Ademas hay que
            comparar al menos 3 videos por grupo: hasta entonces una diferencia es casualidad, no leccion, y
            es mejor no decirle nada al modelo que darle una correlacion de dos videos.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {learnings.map((learning) => (
            <ChartFrame
              key={learning.dimension}
              title={learning.dimension}
              description={`${learning.recommendation} Medido sobre ${learning.sampleSize} video(s) por ${learning.outcomeLabel}.`}
              table={{
                columns: ["Grupo", learning.outcomeLabel, "Videos"],
                rows: learning.buckets.map((b) => [b.label, `${b.mean.toFixed(1)}%`, b.count]),
              }}
            >
              <BarChart
                minAxisTop={100}
                rows={learning.buckets.map((b) => ({
                  label: b.label,
                  value: b.mean,
                  note: `${b.count} video(s)`,
                  display: `${b.mean.toFixed(0)}%`,
                }))}
              />
            </ChartFrame>
          ))}
        </div>
      )}
    </section>
  );
}

function RetentionRanking({ rows }: { rows: LatestSnapshotRow[] }) {
  const ranked = rows
    .map((r) => ({ ...r, retention: r.retentionAtStart === null ? null : Number(r.retentionAtStart) }))
    .filter((r): r is typeof r & { retention: number } => r.retention !== null && Number.isFinite(r.retention))
    .sort((a, b) => b.retention - a.retention)
    .slice(0, 10);

  return (
    <ChartFrame
      title="Los 10 mejores ganchos"
      description="Retencion a los 3 segundos del ultimo dato de cada video. Abrir el mejor y el peor lado a lado es la forma mas rapida de ver que funciona."
      isEmpty={ranked.length === 0}
      empty="Ningun video tiene retencion medida todavia. YouTube tarda ~48h en publicar la curva."
      table={{
        columns: ["Video", "Retencion 3s", "Vistas"],
        rows: ranked.map((r) => [
          r.videoTitle ?? "(sin titulo)",
          `${r.retention.toFixed(1)}%`,
          (r.engagedViews ?? r.views ?? 0).toLocaleString("es-MX"),
        ]),
      }}
    >
      <BarChart
        minAxisTop={100}
        rows={ranked.map((r) => ({
          label: r.videoTitle ?? "(sin titulo)",
          value: r.retention,
          note: `${compactNumber(r.engagedViews ?? r.views ?? 0)} vistas`,
          display: `${r.retention.toFixed(0)}%`,
        }))}
      />
    </ChartFrame>
  );
}

/** Videos ya renderizados que todavia no estan vinculados a un video de YouTube. */
async function unlinkedPublishableVideos() {
  const linkedIds = await db.select({ videoId: publishedVideos.videoId }).from(publishedVideos);
  const ids = linkedIds.map((r) => r.videoId);

  return db
    .select({ id: videos.id, title: videos.title, status: videos.status })
    .from(videos)
    .where(ids.length > 0 ? notInArray(videos.id, ids) : inArray(videos.status, ["ready", "published"]))
    .orderBy(desc(videos.createdAt))
    .limit(20);
}

/**
 * El estado vacio distingue las dos razones por las que no hay datos, porque la accion a tomar es
 * distinta: sin videos vinculados hay que vincularlos, y con videos vinculados solo hay que
 * sincronizar o esperar. Un "aun no hay estadisticas" generico dejaba al usuario sin saber cual era.
 */
function EmptyState({ hasLinks }: { hasLinks: boolean }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-4">
      <p className="text-sm font-medium">Todavia no hay estadisticas capturadas</p>
      {hasLinks ? (
        <p className="text-sm text-muted-foreground">
          Ya tienes videos vinculados, asi que solo falta traer los datos: usa el boton de arriba, o espera
          la sincronizacion automatica. Ten en cuenta que la curva de retencion no existe en YouTube hasta
          ~48h despues de subir el video.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ninguno de tus videos esta vinculado a un video de YouTube. Un video subido a mano desde YouTube
          Studio no queda vinculado solo — hay que decirle a la app cual es. Abajo estan los que faltan.
        </p>
      )}
    </div>
  );
}

function StatsTable({ rows }: { rows: LatestSnapshotRow[] }) {
  return (
    <section className="space-y-2">
      <div className="border-b border-border pb-2">
        <h2 className="text-lg font-semibold">Todos los videos</h2>
        <p className="text-xs text-muted-foreground">
          Las columnas marcadas como clave son las que alimentan el aprendizaje de la IA. Un guion se juzga
          por la retencion; el titulo y la miniatura, por el CTR.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="p-3 font-medium">Video</th>
              <th className="p-3 font-medium">Edad</th>
              <th className="p-3 font-medium">Vistas</th>
              <th className="p-3 font-medium" title="Clave: la nota del gancho">
                Ret. 3s
              </th>
              <th className="p-3 font-medium" title="Clave: la nota del guion completo">
                % visto
              </th>
              <th className="p-3 font-medium" title="Clave: la nota del titulo y la miniatura">
                CTR
              </th>
              <th className="p-3 font-medium" title="Clave: la senal de calidad mas honesta">
                Subs
              </th>
              <th className="p-3 font-medium">Curva</th>
              <th className="p-3 font-medium">Capturado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.videoId} className="border-t border-border">
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/videos/${row.videoId}/analytics`} className="hover:underline">
                      {row.videoTitle ?? "(sin titulo)"}
                    </Link>
                    {row.externalUrl && (
                      <a href={row.externalUrl} target="_blank" rel="noreferrer" title="Abrir en YouTube">
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                    )}
                  </div>
                </td>
                <td className="p-3 tabular-nums">{row.videoAgeDays === null ? "—" : `${row.videoAgeDays}d`}</td>
                <td className="p-3 tabular-nums">{row.engagedViews ?? row.views ?? "—"}</td>
                <td className="p-3 tabular-nums">{percent(row.retentionAtStart)}</td>
                <td className="p-3 tabular-nums">{percent(row.avgViewPercentage)}</td>
                <td className="p-3 tabular-nums">{percent(row.impressionsCtr)}</td>
                <td className="p-3 tabular-nums">{row.subscribersGained ?? "—"}</td>
                <td className="p-3">{row.hasCurve ? "si" : "—"}</td>
                <td className="p-3 text-xs text-muted-foreground">{row.capturedAt.toLocaleString("es-MX")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UnlinkedVideos({ videos: rows }: { videos: { id: string; title: string | null; status: string }[] }) {
  return (
    <section className="space-y-3">
      <div className="border-b border-border pb-2">
        <h2 className="text-lg font-semibold">Videos sin vincular</h2>
        <p className="text-sm text-muted-foreground">
          Estos no tienen un video de YouTube asociado, asi que no se puede traer su rendimiento. Entra a
          cada uno y pega su enlace de YouTube para activar la sincronizacion.
        </p>
      </div>
      <div className="space-y-2">
        {rows.map((video) => (
          <Link
            key={video.id}
            href={`/videos/${video.id}/performance`}
            className="flex items-center justify-between gap-4 rounded-md border border-border p-3 transition-colors hover:bg-muted/50"
          >
            <span className="text-sm">{video.title ?? "(sin titulo)"}</span>
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {video.status}
              </Badge>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function percent(value: string | null): string {
  if (value === null) return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : "—";
}
