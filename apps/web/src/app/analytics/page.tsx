import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { desc, inArray, notInArray } from "drizzle-orm";
import {
  formatBucket,
  getChannelOverview,
  getChannelSeries,
  getCostTotals,
  getDiscoveryEligibility,
  getLatestDiscoveryRun,
  getLearningReadiness,
  getLearningsReport,
  getLinkStatusCounts,
  getPublicationTimeline,
  getRankedByRetention,
  getRetentionDistribution,
  getRetentionHeatmap,
  getWeekdayPerformance,
  latestSnapshotPerVideo,
  resolveTimeRange,
  GRANULARITY_NOUNS,
  type ChannelBucket,
  type LatestSnapshotRow,
  type PublicationPoint,
  type RankedVideo,
  type RetentionBin,
  type RetentionHeatRow,
  type TimeRange,
  type WeekdayRow,
} from "@video-generator/analytics";
import type { DimensionCoverage, PerformanceLearning } from "@video-generator/types";
import { db, publishedVideos, videos } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { SyncAllStatsButton } from "@/components/sync-all-stats-button";
import { DiscoverDimensionsButton } from "@/components/discover-dimensions-button";
import { ChartFrame } from "@/components/charts/chart-frame";
import { LineChart } from "@/components/charts/line-chart";
import { ColumnChart } from "@/components/charts/column-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { Heatmap } from "@/components/charts/heatmap";
import { Funnel } from "@/components/charts/funnel";
import { TimeControls } from "@/components/charts/time-controls";
import { HeroNumber, StatTile } from "@/components/charts/stat-tile";
import { compactNumber, formatDay, formatPercent, formatUsd, movingAverage } from "@/components/charts/scales";
import { withOverHundredNote } from "@/lib/retention-copy";

export const dynamic = "force-dynamic";

/** La tabla del final se pinta fila a fila; el resto de la pantalla agrega en SQL y no depende de esto. */
const TABLE_LIMIT = 100;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const time = resolveTimeRange(await searchParams, { granularity: "day", range: "90d" });

  // Una sola ronda en paralelo. Encadenar estos `await` convertiria la pantalla en una docena de
  // viajes secuenciales a la base antes de poder pintar el primer pixel.
  const [
    overview,
    series,
    timeline,
    learningsReport,
    readiness,
    discoveryEligibility,
    discoveryRun,
    costTotals,
    distribution,
    heatmap,
    weekday,
    best,
    worst,
    latestStats,
    links,
    unlinked,
  ] = await Promise.all([
    getChannelOverview(),
    getChannelSeries(time),
    getPublicationTimeline(),
    getLearningsReport(),
    getLearningReadiness(),
    getDiscoveryEligibility(),
    getLatestDiscoveryRun(),
    getCostTotals(),
    getRetentionDistribution(),
    getRetentionHeatmap(),
    getWeekdayPerformance(),
    getRankedByRetention(8, "best"),
    getRankedByRetention(8, "worst"),
    latestSnapshotPerVideo(TABLE_LIMIT),
    getLinkStatusCounts(),
    unlinkedPublishableVideos(),
  ]);

  return (
    <div className="space-y-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Rendimiento del canal</h1>
        <p className="text-sm text-muted-foreground">
          Como le fue a cada video publicado y que ha aprendido la IA de eso. Se sincroniza solo cada 6 horas
          (job <code>poll-stats</code> del worker). Cada grafica trae un desplegable{" "}
          <span className="font-medium text-foreground">Como se lee</span> con lo que significa y que hacer
          con ella.
        </p>
      </div>

      <SyncAllStatsButton linkedCount={links.published} />

      {links.failed > 0 && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          {links.failed} video(s) tienen un vinculo de YouTube invalido y se estan omitiendo. Entra a su
          pantalla de rendimiento para corregirlo.
        </p>
      )}

      {overview.videosWithStats === 0 ? (
        <EmptyState hasLinks={links.published > 0} />
      ) : (
        <>
          <Overview overview={overview} costTotals={costTotals} />

          <section className="space-y-4">
            <SectionHeading
              title="Evolucion en el tiempo"
              description="El periodo y la agrupacion mandan sobre las tres graficas de esta seccion a la vez, para que se puedan comparar entre si."
            />
            <TimeControls basePath="/analytics" current={time} />
            <NewViewsChart series={series} time={time} />
            <CumulativeViewsChart series={series} time={time} />
            <PublishingChart series={series} time={time} />
          </section>

          <section className="space-y-4">
            <SectionHeading
              title="Calidad y aprendizaje"
              description="Estas miran a TODOS los videos publicados, no al periodo elegido arriba: un patron de comportamiento necesita toda la muestra disponible para sostenerse."
            />
            <GrowthChart timeline={timeline} />
            <DistributionChart bins={distribution} />
            <RetentionHeatmapChart rows={heatmap} />
            <WeekdayChart rows={weekday} />
          </section>

          <LearningsSection
            learnings={learningsReport.learnings}
            coverage={learningsReport.coverage}
            readiness={readiness}
            discoveryRun={discoveryRun}
            discoveryEligibility={discoveryEligibility}
          />

          <section className="space-y-4">
            <SectionHeading
              title="Extremos"
              description="El mejor y el peor gancho, lado a lado: comparar esos dos videos es la lectura mas rapida que da este tablero."
            />
            <RankingChart title="Los 8 mejores ganchos" rows={best} direction="best" />
            <RankingChart title="Los 8 peores ganchos" rows={worst} direction="worst" />
          </section>

          <StatsTable rows={latestStats} total={overview.videosWithStats} />
        </>
      )}

      {unlinked.length > 0 && <UnlinkedVideos videos={unlinked} />}
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-border pb-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
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
  const costPerThousand = overview.totalViews > 0 ? (costTotals.usd / overview.totalViews) * 1000 : null;

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
        <StatTile label="Suscriptores ganados" value={compactNumber(overview.totalSubscribers)} />
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

      <ChannelFunnel overview={overview} />
    </section>
  );
}

function ChannelFunnel({ overview }: { overview: Awaited<ReturnType<typeof getChannelOverview>> }) {
  return (
    <ChartFrame
      title="El embudo del canal"
      description="Cuanta gente sobrevive a cada paso, desde que YouTube ensena el video hasta que alguien se suscribe."
      howToRead={{
        measures:
          "Las cuatro etapas por las que pasa un espectador: YouTube ensena la miniatura (impresion), alguien la abre (vista), se queda mas alla de los primeros segundos (vista con permanencia) y termina suscribiendose.",
        read: "Lo que se lee no son las cifras sino el porcentaje que sobrevive de un escalon al siguiente. La caida mas grande senala donde esta el problema.",
        act: "Si caen las impresiones a vistas, el problema es el titulo y la miniatura. Si caen las vistas a permanencia, es el gancho. Si la permanencia es buena pero nadie se suscribe, el video entretiene pero no da razones para volver.",
        source:
          "Ultima captura de cada video publicado. En Shorts YouTube no reporta impresiones: ese escalon aparece como 'sin dato', que no es lo mismo que cero.",
      }}
      isEmpty={overview.totalRawViews === 0 && overview.totalImpressions === 0}
      empty="Todavia no hay vistas medidas."
      table={{
        columns: ["Etapa", "Total"],
        rows: [
          ["Impresiones", overview.totalImpressions.toLocaleString("es-MX")],
          ["Vistas", overview.totalRawViews.toLocaleString("es-MX")],
          ["Vistas con permanencia", overview.totalEngagedViews.toLocaleString("es-MX")],
          ["Suscriptores ganados", overview.totalSubscribers.toLocaleString("es-MX")],
        ],
      }}
    >
      <Funnel
        steps={[
          { label: "Impresiones", value: overview.totalImpressions, help: "Veces que YouTube mostro la miniatura." },
          { label: "Vistas", value: overview.totalRawViews, help: "Veces que alguien abrio el video." },
          {
            label: "Vistas con permanencia",
            value: overview.totalEngagedViews,
            help: "Se quedaron mas alla de los primeros segundos. Es el tamano de muestra real.",
          },
          {
            label: "Suscriptores ganados",
            value: overview.totalSubscribers,
            help: "La senal de calidad mas honesta que da YouTube.",
          },
        ]}
      />
    </ChartFrame>
  );
}

/**
 * Vistas NUEVAS por periodo. Es la grafica que responde "¿como me fue este mes?".
 *
 * Va en columnas y no en linea porque cada barra es una cantidad cerrada e independiente: entre
 * marzo y abril no hay un valor intermedio que una linea pudiera afirmar.
 */
function NewViewsChart({ series, time }: { series: ChannelBucket[]; time: TimeRange }) {
  const noun = GRANULARITY_NOUNS[time.granularity];
  const values = series.map((b) => b.newViews);

  return (
    <ChartFrame
      title={`Vistas nuevas por ${noun}`}
      description={`Cuantas vistas gano el canal en cada ${noun}, no cuantas lleva acumuladas.`}
      howToRead={{
        measures: `La diferencia entre las vistas totales al cerrar un ${noun} y las del ${noun} anterior: lo que se gano durante ese periodo.`,
        read: `Barras que crecen de ${noun} en ${noun} significan que el canal acelera. Una barra alta aislada suele ser un video que se distribuyo bien; una meseta significa que el catalogo viejo ya no trae gente nueva y todo depende de lo que publiques.`,
        act: "Cruza los picos con la grafica de publicaciones: si un pico coincide con un video, ese gancho merece estudiarse y repetirse.",
        source: `El primer ${noun} sale vacio a proposito: no hay periodo anterior contra el que restar. Un video publicado dentro del periodo suma todas sus vistas de golpe en ese ${noun}.`,
      }}
      isEmpty={values.filter((v) => v !== null).length === 0}
      empty={`Hacen falta capturas en al menos dos ${noun}s consecutivos para poder restar uno del otro.`}
      table={{
        columns: [noun, "Vistas nuevas", "Acumuladas", "Videos con captura"],
        rows: series.map((b) => [
          formatBucket(b.bucket, time.granularity),
          b.newViews === null ? "—" : b.newViews.toLocaleString("es-MX"),
          b.cumulativeViews === null ? "—" : b.cumulativeViews.toLocaleString("es-MX"),
          b.videosWithCapture,
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

function CumulativeViewsChart({ series, time }: { series: ChannelBucket[]; time: TimeRange }) {
  return (
    <ChartFrame
      title="Vistas acumuladas del canal"
      description="El total historico al cerrar cada periodo. Solo puede subir."
      howToRead={{
        measures:
          "El contador de vistas de todos los videos publicados, sumado. YouTube lo reporta acumulado, asi que esta curva es el tamano del canal a lo largo del tiempo.",
        read: "La PENDIENTE es lo que importa, no la altura: cuanto mas inclinada, mas rapido crece. Un tramo plano significa que en ese periodo casi no entro gente nueva.",
        act: "Si la curva se aplana mientras sigues publicando, el problema no es el ritmo sino que los videos nuevos no alcanzan a nadie: mira el CTR y la retencion antes de publicar mas.",
        source:
          "Se toma la ultima captura de cada video dentro del periodo, nunca la suma de todas: sumarlas contaria el mismo video una vez por captura.",
      }}
      isEmpty={series.filter((b) => b.cumulativeViews !== null).length < 2}
      empty="Hacen falta al menos dos periodos con capturas para dibujar una evolucion."
      table={{
        columns: [GRANULARITY_NOUNS[time.granularity], "Vistas acumuladas"],
        rows: series.map((b) => [
          formatBucket(b.bucket, time.granularity),
          b.cumulativeViews === null ? "—" : b.cumulativeViews.toLocaleString("es-MX"),
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

function PublishingChart({ series, time }: { series: ChannelBucket[]; time: TimeRange }) {
  const noun = GRANULARITY_NOUNS[time.granularity];
  return (
    <ChartFrame
      title={`Videos publicados por ${noun}`}
      description="El ritmo de produccion, para contrastarlo con el ritmo de crecimiento."
      howToRead={{
        measures: `Cuantos videos se publicaron en cada ${noun}, por su fecha de publicacion en YouTube.`,
        read: "Se lee junto a las vistas nuevas. Si publicas mas y las vistas no suben, el problema es de calidad, no de cantidad. Si publicas menos y las vistas aguantan, el catalogo viejo esta trabajando solo.",
        act: "Un hueco largo aqui explica casi siempre una meseta en las vistas: la distribucion de Shorts premia la constancia.",
        source: "Solo cuenta videos vinculados a YouTube con fecha de publicacion conocida.",
      }}
      isEmpty={series.every((b) => b.published === 0)}
      empty="No hay videos publicados dentro del periodo elegido. Prueba un periodo mas largo."
      table={{
        columns: [noun, "Videos publicados"],
        rows: series.map((b) => [formatBucket(b.bucket, time.granularity), b.published]),
      }}
    >
      <ColumnChart
        labels={series.map((b) => formatBucket(b.bucket, time.granularity))}
        values={series.map((b) => b.published)}
        format={(v) => Math.round(v).toString()}
        valueLabel="videos publicados"
        colorIndex={2}
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
      description={`${metric} de cada video, en orden de publicacion.`}
      howToRead={{
        measures: `Cada punto es un video colocado en su fecha de publicacion, con su ${metric.toLowerCase()}. La linea es la media movil de 5 videos.`,
        read: "Mira la LINEA, no los puntos sueltos: video a video la metrica salta demasiado para significar algo. Si la linea sube de izquierda a derecha, lo aprendido esta funcionando.",
        act: "Si la linea es plana pese a haber lecciones activas, o se apoyan en muy pocos videos todavia, o el guion no las esta aplicando de verdad. Compara el gancho del mejor y el peor video para verlo.",
        source:
          "Ordenado por fecha de publicacion, no de medicion. Los ultimos videos pueden moverse aun: llevan poco tiempo publicados.",
      }}
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
 * Histograma de la retencion: la forma correcta para una DISTRIBUCION, y dice algo que ningun
 * promedio puede decir — si el canal es consistente o si mezcla aciertos con fracasos.
 */
function DistributionChart({ bins }: { bins: RetentionBin[] }) {
  return (
    <ChartFrame
      title="Como se reparte la retencion entre los videos"
      description="Cuantos videos caen en cada franja de retencion a los 3 segundos."
      howToRead={{
        measures:
          "Cada columna cuenta cuantos videos tienen una retencion dentro de esa franja. No es una serie de tiempo: el eje horizontal son niveles de retencion, de peor a mejor.",
        read: "Una sola loma estrecha = canal consistente. Dos lomas separadas = conviven dos tipos de video, unos que funcionan y otros que no. Una cola larga a la izquierda son fracasos hundiendo el promedio.",
        act: "Con dos lomas, la accion no es 'subir el promedio' sino averiguar que distingue al grupo bueno del malo y dejar de hacer el segundo. Las lecciones de mas abajo son justo ese analisis.",
        source:
          "Ultima captura de cada video publicado que ya tenga curva de retencion. En Shorts los valores pasan de 100 porque cuentan las repeticiones.",
      }}
      isEmpty={bins.every((b) => b.videos === 0)}
      empty="Ningun video tiene retencion medida todavia. YouTube tarda ~48h en publicar la curva."
      table={{
        columns: ["Franja de retencion", "Videos"],
        rows: bins.map((b) => [`${Math.round(b.from)}% – ${Math.round(b.to)}%`, b.videos]),
      }}
    >
      <ColumnChart
        labels={bins.map((b) => `${Math.round(b.from)}%`)}
        values={bins.map((b) => b.videos)}
        format={(v) => Math.round(v).toString()}
        valueLabel="videos"
        colorIndex={2}
      />
    </ChartFrame>
  );
}

/** El cruce video x tramo del video: la unica vista que revela un problema estructural del canal. */
function RetentionHeatmapChart({ rows }: { rows: RetentionHeatRow[] }) {
  const columns = Array.from({ length: 10 }, (_, i) => `${i * 10}%`);

  return (
    <ChartFrame
      title="Donde se cae la audiencia, video por video"
      description="Cada fila es un video; cada columna, un tramo del 10% de su duracion. Cuanto mas oscuro, mas gente seguia viendo ahi."
      howToRead={{
        measures:
          "La curva de retencion de cada video resumida en diez tramos. El color es el porcentaje de la audiencia que seguia viendo en ese punto.",
        read: "Leelo por COLUMNAS, no por filas. Si una columna entera se aclara de golpe, todos tus videos pierden gente en el mismo punto de su duracion, y eso ya no es un guion malo sino una estructura mala.",
        act: "Localiza la primera columna clara y mira que pasa ahi en tus guiones: casi siempre es el momento en que acaba el gancho y empieza el contexto. Ese trozo es el que hay que recortar o reescribir.",
        source:
          "Los videos mas recientes que ya tienen curva publicada. YouTube tarda ~48h en calcularla, asi que los ultimos videos pueden faltar.",
      }}
      isEmpty={rows.length === 0}
      empty="Ningun video tiene curva de retencion todavia. YouTube la publica ~48h despues de subir el video y necesita un minimo de reproducciones."
      table={{
        columns: ["Video", ...columns],
        rows: rows.map((r) => [
          r.title ?? "(sin titulo)",
          ...r.deciles.map((d) => (d === null ? "—" : `${d.toFixed(0)}%`)),
        ]),
      }}
    >
      <Heatmap
        columns={columns}
        rows={rows.map((r) => ({ label: r.title ?? "(sin titulo)", values: r.deciles }))}
        format={(v) => `${v.toFixed(0)}%`}
        scaleLabel="Seguian viendo:"
      />
    </ChartFrame>
  );
}

const WEEKDAY_NAMES = ["", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];

function WeekdayChart({ rows }: { rows: WeekdayRow[] }) {
  const thin = rows.some((r) => r.videos < 3);

  return (
    <ChartFrame
      title="¿Que dia conviene publicar?"
      description="Vistas medias de los videos segun el dia de la semana en que se publicaron."
      howToRead={{
        measures:
          "El promedio de vistas de los videos publicados cada dia de la semana. Al lado de cada barra va cuantos videos sostienen ese promedio.",
        read: `Mira el conteo antes que la barra${thin ? " — ahora mismo varios dias se apoyan en menos de 3 videos" : ""}. Un dia con dos videos no dice nada: basta uno que se viralizara para que ese dia parezca el mejor.`,
        act: "Con cinco o mas videos por dia y una diferencia grande y sostenida, vale la pena concentrar ahi las publicaciones. Antes de eso, publicar con constancia importa mas que el dia.",
        source: "Fecha de publicacion en YouTube de cada video vinculado, cruzada con su ultima captura de estadisticas.",
      }}
      isEmpty={rows.length === 0}
      empty="Ningun video vinculado tiene fecha de publicacion todavia."
      table={{
        columns: ["Dia", "Videos", "Vistas medias", "Retencion media"],
        rows: rows.map((r) => [
          WEEKDAY_NAMES[r.weekday] ?? String(r.weekday),
          r.videos,
          r.avgViews === null ? "—" : Math.round(r.avgViews).toLocaleString("es-MX"),
          formatPercent(r.avgRetentionAtStart),
        ]),
      }}
    >
      <BarChart
        format={compactNumber}
        rows={rows.map((r) => ({
          label: WEEKDAY_NAMES[r.weekday] ?? String(r.weekday),
          value: r.avgViews ?? 0,
          display: r.avgViews === null ? "—" : compactNumber(r.avgViews),
          note: `${r.videos} video(s)`,
        }))}
      />
    </ChartFrame>
  );
}

function RankingChart({ title, rows, direction }: { title: string; rows: RankedVideo[]; direction: "best" | "worst" }) {
  return (
    <ChartFrame
      title={title}
      description="Retencion a los 3 segundos del ultimo dato de cada video."
      howToRead={{
        measures:
          "El porcentaje de la audiencia que seguia viendo pasados los primeros segundos. Es la nota del gancho y no depende de la duracion del video.",
        read:
          direction === "best"
            ? "Estos son los ganchos que funcionan. Lo util no es la cifra sino el texto: abre los videos y mira con que frase empiezan."
            : "Estos son los ganchos que fallan. Casi siempre comparten un defecto: abrir con contexto en vez de con la promesa.",
        act: "Abre el primero de esta lista y el primero de la otra y compara solo sus dos primeras frases. Esa comparacion es la que se traduce en una instruccion util para el siguiente guion.",
        source: "Ultima captura de cada video publicado con curva de retencion disponible.",
      }}
      isEmpty={rows.length === 0}
      empty="Ningun video tiene retencion medida todavia."
      table={{
        columns: ["Video", "Retencion 3s", "Vistas"],
        rows: rows.map((r) => [r.title ?? "(sin titulo)", `${r.value.toFixed(1)}%`, r.views.toLocaleString("es-MX")]),
      }}
    >
      <BarChart
        minAxisTop={100}
        rows={rows.map((r) => ({
          label: r.title ?? "(sin titulo)",
          value: r.value,
          note: `${compactNumber(r.views)} vistas`,
          display: `${r.value.toFixed(0)}%`,
        }))}
        colorIndex={direction === "best" ? 0 : 1}
      />
    </ChartFrame>
  );
}

/**
 * Las lecciones que el motor de aprendizaje le esta pasando al prompt, dibujadas.
 *
 * Es la misma funcion que usa el worker al escribir el guion, no una copia: lo que se ve aqui es
 * literalmente lo que la IA esta leyendo.
 */
/**
 * Que se le dice al usuario de cada dimension que NO produjo leccion.
 *
 * La distincion que importa es "esto se arregla publicando" contra "esto no se arregla solo": una
 * dimension sin variacion (todos los videos iguales en ese atributo) puede esperar mil videos y
 * nunca aprender nada, porque el grupo contrario no existe. Decir "todavia no hay datos" en ese caso
 * es mandar al usuario a esperar algo que no va a pasar.
 */
const COVERAGE_COPY: Record<Exclude<DimensionCoverage["status"], "aprendiendo">, string> = {
  sin_variacion: "No puede aprender: todos tus videos son iguales en esto, no hay grupo con que comparar.",
  muestra_insuficiente: "Faltan videos: hay grupos distintos, pero alguno no llega a 3 videos.",
  sin_diferencia: "Sin diferencia clara: los grupos rinden casi igual, no hay leccion que sacar.",
  sin_datos: "Ningun video tiene este dato medido todavia.",
};

/** El diagnostico de las dimensiones que no estan produciendo leccion, y por que. */
function CoverageSection({ coverage }: { coverage: DimensionCoverage[] }) {
  const pending = coverage.filter((c) => c.status !== "aprendiendo");
  if (pending.length === 0) return null;

  return (
    <details className="rounded-md border border-border bg-muted/30 p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Lo que la IA todavia no puede aprender ({pending.length})
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        El motor compara {coverage.length} dimensiones. Las que no aparecen arriba no siempre estan
        &quot;esperando datos&quot;: si todos tus videos comparten el mismo valor, esa dimension no puede
        aprender nada por mas que publiques, y la unica forma de desbloquearla es publicar a proposito
        algun video del otro grupo.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1 pr-3 text-left font-medium">Dimension</th>
              <th className="py-1 pr-3 text-left font-medium">Por que no aprende</th>
              <th className="py-1 text-left font-medium">Grupos observados</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((c) => (
              <tr key={c.dimension} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-3 align-top font-medium">{c.dimension}</td>
                <td className="py-1.5 pr-3 align-top text-muted-foreground">
                  {COVERAGE_COPY[c.status as Exclude<DimensionCoverage["status"], "aprendiendo">]}
                </td>
                <td className="py-1.5 align-top text-muted-foreground">
                  {c.groups.length === 0
                    ? "—"
                    : c.groups.map((g) => `${g.label} (${g.count})`).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function LearningsSection({
  learnings,
  coverage,
  readiness,
  discoveryEligibility,
  discoveryRun,
}: {
  learnings: PerformanceLearning[];
  coverage: DimensionCoverage[];
  readiness: Awaited<ReturnType<typeof getLearningReadiness>>;
  discoveryEligibility: Awaited<ReturnType<typeof getDiscoveryEligibility>>;
  discoveryRun: Awaited<ReturnType<typeof getLatestDiscoveryRun>>;
}) {
  return (
    <section className="space-y-4">
      <SectionHeading
        title="Lo que la IA aprendio de los videos pasados"
        description="Patrones medidos sobre todo el canal, no sobre un tema. Estos textos entran tal cual en el prompt del siguiente guion."
      />

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
              howToRead={{
                measures: `Los videos se parten en grupos segun su ${learning.dimension}, y cada grupo se califica con su ${learning.outcomeLabel} media, PONDERADA por recencia: un video reciente mueve el promedio mas que uno viejo.`,
                read: "La distancia entre la barra mas larga y la mas corta es la leccion. Al lado de cada barra va cuantos videos la sostienen: con 3 es una pista, con 20 es una regla. La columna 'Peso efectivo' de la tabla es cuantos videos valen esos videos una vez ponderados — si es mucho menor que la cuenta, el grupo se apoya casi solo en los mas recientes.",
                act: "Esto ya se le esta pasando a la IA al escribir el siguiente guion. Aun asi, de vez en cuando genera un video con la opcion perdedora a proposito, para comprobar que la leccion no era casualidad. Si no estas de acuerdo con la conclusion, la forma de cambiarla es publicar videos del grupo perdedor y medirlos, no editar el prompt.",
                source:
                  "Solo entran videos con vistas y dias suficientes para que el porcentaje sea estable, y solo grupos cuyo peso efectivo llega a 3.",
              }}
              table={{
                columns: ["Grupo", learning.outcomeLabel, "Videos", "Peso efectivo"],
                rows: learning.buckets.map((b) => [
                  b.label,
                  `${b.mean.toFixed(1)}%`,
                  b.count,
                  b.effectiveCount.toFixed(1),
                ]),
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

      <CoverageSection coverage={coverage} />
      <DiscoverDimensionsButton eligibility={discoveryEligibility} initialRun={discoveryRun} />
    </section>
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

function StatsTable({ rows, total }: { rows: LatestSnapshotRow[]; total: number }) {
  return (
    <section className="space-y-2">
      <SectionHeading
        title="Todos los videos"
        description="Las columnas marcadas como clave son las que alimentan el aprendizaje de la IA. Un guion se juzga por la retencion; el titulo y la miniatura, por el CTR."
      />
      {total > rows.length && (
        <p className="text-xs text-muted-foreground">
          Se listan {rows.length} de {total}. Las cifras de arriba si miran a todos: se calculan agregando en
          la base de datos, no contando estas filas.
        </p>
      )}
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
      <SectionHeading
        title="Videos sin vincular"
        description="Estos no tienen un video de YouTube asociado, asi que no se puede traer su rendimiento. Entra a cada uno y pega su enlace de YouTube para activar la sincronizacion."
      />
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
