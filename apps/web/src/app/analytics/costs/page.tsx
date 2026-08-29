import Link from "next/link";
import {
  effectiveUnitPrice,
  formatBucket,
  getChannelOverview,
  getCostByModel,
  getCostByStage,
  getCostByStageSeries,
  getCostEfficiency,
  getCostSeries,
  getCostTotals,
  resolveTimeRange,
  GRANULARITY_NOUNS,
  UNIT_LABELS,
  type CostByModelRow,
  type CostBucketRow,
  type CostEfficiencyRow,
  type CostStageBucketRow,
  type TimeRange,
} from "@video-generator/analytics";
import { COST_STAGES } from "@video-generator/types";
import { ChartFrame } from "@/components/charts/chart-frame";
import { BarChart, CompositionBar } from "@/components/charts/bar-chart";
import { ColumnChart, StackedColumnChart } from "@/components/charts/column-chart";
import { ScatterPlot } from "@/components/charts/scatter-plot";
import { TimeControls } from "@/components/charts/time-controls";
import { HeroNumber, StatTile } from "@/components/charts/stat-tile";
import { compactNumber, formatMxn, formatUsd } from "@/components/charts/scales";
import { CostDisclaimer } from "@/components/cost-disclaimer";
import { STAGE_LABELS } from "@/lib/version-costs";

export const dynamic = "force-dynamic";

/** Cuantos videos entran en la nube de puntos. Mas alla, los puntos se tapan entre si. */
const SCATTER_LIMIT = 150;

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Por defecto un ano por mes: el gasto se mueve al ritmo de los renders, no al de las vistas, y
  // por dia serian barras de casi nada.
  const time = resolveTimeRange(await searchParams, { granularity: "month", range: "12m" });

  const [totals, byStage, byModel, series, stageSeries, efficiency, channel] = await Promise.all([
    getCostTotals(),
    getCostByStage(),
    getCostByModel(),
    getCostSeries(time),
    getCostByStageSeries(time),
    getCostEfficiency(SCATTER_LIMIT),
    getChannelOverview(),
  ]);

  const paid = byModel.filter((m) => m.usd > 0);
  const free = byModel.filter((m) => m.usd === 0);
  const textModels = paid.filter((m) => m.providerType === "ai");
  const voiceModels = paid.filter((m) => m.providerType === "tts");
  const otherPaid = paid.filter((m) => m.providerType !== "ai" && m.providerType !== "tts");

  const costPerThousandViews = channel.totalViews > 0 ? (totals.usd / channel.totalViews) * 1000 : null;

  if (totals.versions === 0) {
    return (
      <div className="space-y-4">
        <Header />
        <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Todavia no se ha renderizado ningun video</p>
          <p className="mt-1 text-xs text-muted-foreground">
            El costo se calcula y se congela al terminar el render de cada version, asi que esta pantalla se
            llena en cuanto exista el primer video terminado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <Header />

      <section className="space-y-5">
        <HeroNumber
          label="Costo total de produccion"
          value={formatUsd(totals.usd)}
          hint={`${formatMxn(totals.mxn)} · ${totals.versions} version(es) renderizada(s) de ${totals.videosWithCost} video(s).`}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Costo medio por video"
            value={formatUsd(totals.avgUsdPerVideo)}
            hint="Incluye las regeneraciones: un video con tres versiones pago tres veces sus etapas repetidas."
          />
          <StatTile
            label="Costo por 1000 vistas"
            value={costPerThousandViews === null ? "—" : formatUsd(costPerThousandViews)}
            hint={`Sobre ${compactNumber(channel.totalViews)} vistas medidas.`}
          />
          <StatTile
            label="Modelos de pago en uso"
            value={String(new Set(paid.map((m) => `${m.providerName}:${m.model ?? ""}`)).size)}
            hint="Cuentan solo los que han generado algun cobro."
          />
          <StatTile
            label="Proveedores gratis"
            value={String(free.length)}
            hint="Locales (Ollama, Piper, ffmpeg) y stock libre de derechos."
          />
        </div>
      </section>

      <ChartFrame
        title="En que se va el dinero"
        description="Reparto del gasto entre las cinco etapas del pipeline, sumando todos los videos y todas sus versiones."
        howToRead={{
          measures:
            "El total historico partido por etapa: guion (IA), voz (TTS), video de stock, edicion (IA) y render.",
          read: "Es una sola barra al 100%: lo que se lee es la PROPORCION, no la longitud. El bloque mas ancho es donde esta el dinero, y por tanto el unico sitio donde un cambio de proveedor se nota.",
          act: "Optimizar una etapa que ocupa el 5% no cambia nada aunque la abarates a cero. Empieza siempre por el bloque mas ancho.",
          source: "Desglose guardado en cada version al renderizarla. Las etapas gratuitas aparecen en cero y no ocupan bloque.",
        }}
        isEmpty={byStage.every((s) => s.usd === 0)}
        empty="Todas las etapas estan corriendo con proveedores gratuitos ahora mismo, asi que no hay nada que repartir."
        table={{
          columns: ["Etapa", "USD", "MXN", "Videos"],
          rows: byStage.map((s) => [STAGE_LABELS[s.stage] ?? s.stage, formatUsd(s.usd), formatMxn(s.mxn), s.videos]),
        }}
      >
        <CompositionBar
          format={formatUsd}
          segments={byStage.map((s) => ({ label: STAGE_LABELS[s.stage] ?? s.stage, value: s.usd }))}
        />
      </ChartFrame>

      <section className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 className="text-lg font-semibold">Evolucion del gasto</h2>
          <p className="text-sm text-muted-foreground">
            El periodo y la agrupacion mandan sobre las dos graficas de esta seccion.
          </p>
        </div>
        <TimeControls basePath="/analytics/costs" current={time} />
        <StageSeriesChart series={stageSeries} time={time} />
        <UnitCostChart series={series} time={time} />
      </section>

      <section className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 className="text-lg font-semibold">Que modelo cuesta que</h2>
          <p className="text-sm text-muted-foreground">
            El gasto acumulado de cada modelo, con el precio unitario que lo explica.
          </p>
        </div>
        <ModelChart
          title="Modelos de texto (guion y edicion)"
          description="Lo que ha costado cada modelo de lenguaje."
          rows={textModels}
          empty="Ningun modelo de texto de pago ha generado costo todavia. Con Ollama en local, esta etapa es gratis."
        />
        <ModelChart
          title="Voces (TTS)"
          description="Lo que ha costado cada voz."
          rows={voiceModels}
          empty="Ninguna voz de pago ha generado costo todavia. Piper y Coqui corren en local y no cobran."
        />
        {otherPaid.length > 0 && (
          <ModelChart
            title="Otros proveedores de pago"
            description="Stock de pago o cualquier otro adaptador que reporte un cobro."
            rows={otherPaid}
            empty=""
          />
        )}
      </section>

      <section className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 className="text-lg font-semibold">¿El gasto se convierte en audiencia?</h2>
          <p className="text-sm text-muted-foreground">
            La pregunta de eficiencia de verdad, mirada de dos formas: la relacion general y los casos
            concretos.
          </p>
        </div>
        <CostVsViewsChart rows={efficiency} />
        <EfficiencyChart rows={efficiency} />
      </section>

      {free.length > 0 && <FreeProviders rows={free} />}

      <CostDisclaimer />
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-bold">Costos</h1>
      <p className="text-sm text-muted-foreground">
        Cuanto cuesta producir con cada modelo de texto y de voz, en que etapa se va el dinero y si ese
        gasto se convierte en vistas. Cada grafica trae un desplegable{" "}
        <span className="font-medium text-foreground">Como se lee</span>.
      </p>
    </div>
  );
}

/** Columnas apiladas: cuanto se gasto cada periodo Y en que. */
function StageSeriesChart({ series, time }: { series: CostStageBucketRow[]; time: TimeRange }) {
  const noun = GRANULARITY_NOUNS[time.granularity];
  // Solo las etapas que llegaron a costar algo: una serie plana en cero gasta un color de la paleta
  // y una linea de leyenda sin aportar nada.
  const stages = COST_STAGES.filter((stage) => series.some((b) => (b.byStage[stage] ?? 0) > 0));

  return (
    <ChartFrame
      title={`Gasto por ${noun}, por etapa`}
      description={`Cuanto costo cada ${noun} y de que estaba hecho ese costo.`}
      howToRead={{
        measures: `La suma del costo de todas las versiones renderizadas en cada ${noun}, partida por etapa del pipeline.`,
        read: "La altura total es el gasto del periodo; los bloques dicen en que. Un cambio de proveedor no se ve como una curva que baja, se ve como un bloque de color que se encoge o desaparece.",
        act: "Si un bloque crece sin que crezca el numero de videos, algo se encarecio: un modelo con precio nuevo, guiones mas largos o mas regeneraciones por video.",
        source: `Se usa el costo congelado en cada version al renderizarla, con la fecha de ese render. Actualizar la tabla de precios no reescribe el pasado.`,
      }}
      series={stages.map((stage, i) => ({
        label: STAGE_LABELS[stage] ?? stage,
        color: `var(--chart-${(i % 5) + 1})`,
      }))}
      isEmpty={series.length === 0 || stages.length === 0}
      empty="No hubo gasto en el periodo elegido, o todas las etapas corrieron gratis. Prueba un periodo mas largo."
      table={{
        columns: [noun, ...stages.map((s) => STAGE_LABELS[s] ?? s), "Total"],
        rows: series.map((b) => [
          formatBucket(b.bucket, time.granularity),
          ...stages.map((s) => formatUsd(b.byStage[s] ?? 0)),
          formatUsd(b.total),
        ]),
      }}
    >
      <StackedColumnChart
        labels={series.map((b) => formatBucket(b.bucket, time.granularity))}
        format={formatUsd}
        series={stages.map((stage) => ({
          label: STAGE_LABELS[stage] ?? stage,
          values: series.map((b) => b.byStage[stage] ?? 0),
        }))}
      />
    </ChartFrame>
  );
}

/**
 * Costo MEDIO por video y periodo.
 *
 * Es la unica de las graficas de gasto que dice si el proceso esta mejorando: el total sube cuando
 * se hacen mas videos, lo cual no es una mala noticia. Esta se mantiene comparable entre periodos.
 */
function UnitCostChart({ series, time }: { series: CostBucketRow[]; time: TimeRange }) {
  const noun = GRANULARITY_NOUNS[time.granularity];

  return (
    <ChartFrame
      title={`Costo medio por video, por ${noun}`}
      description="Lo que costo de media producir un video en cada periodo."
      howToRead={{
        measures: `El gasto del ${noun} dividido entre los videos distintos que se renderizaron en ese ${noun}.`,
        read: "Esta es la grafica del proceso, no del volumen: el gasto total sube cuando produces mas, que no es malo. Aqui, bajar SI es bueno.",
        act: "Un salto hacia arriba sin cambio de proveedor suele significar regeneraciones: un video con tres versiones paga tres veces las etapas que se repitieron. Cambiar la musica o re-renderizar es barato; regenerar el guion y la voz no.",
        source: `Videos distintos por ${noun}, no versiones: un video con tres versiones cuenta una vez en el divisor y tres en el gasto.`,
      }}
      isEmpty={series.every((b) => b.usdPerVideo === null)}
      empty="No hubo renders en el periodo elegido."
      table={{
        columns: [noun, "Costo medio por video", "Gasto total", "Videos", "Versiones"],
        rows: series.map((b) => [
          formatBucket(b.bucket, time.granularity),
          b.usdPerVideo === null ? "—" : formatUsd(b.usdPerVideo),
          formatUsd(b.usd),
          b.videos,
          b.versions,
        ]),
      }}
    >
      <ColumnChart
        labels={series.map((b) => formatBucket(b.bucket, time.granularity))}
        values={series.map((b) => b.usdPerVideo)}
        format={formatUsd}
        valueLabel="costo medio por video"
        colorIndex={1}
      />
    </ChartFrame>
  );
}

/**
 * Gasto por modelo, con su precio unitario efectivo al lado.
 *
 * Las dos cifras juntas son lo que hace accionable la grafica: el largo de la barra dice donde se
 * fue el dinero y la nota dice si fue porque el modelo es caro o porque se uso mucho. Con una sola
 * de las dos, la conclusion natural ("cambiemos el modelo mas caro") puede ser justo la equivocada.
 */
function ModelChart({
  title,
  description,
  rows,
  empty,
}: {
  title: string;
  description: string;
  rows: CostByModelRow[];
  empty: string;
}) {
  const withPrice = rows.map((row) => ({ row, unitPrice: effectiveUnitPrice(row.usd, row.units, row.unitKind) }));

  return (
    <ChartFrame
      title={title}
      description={description}
      howToRead={{
        measures:
          "La barra es el gasto acumulado de ese modelo. Debajo va su precio efectivo por millon de unidades (tokens en texto, caracteres en voz), que es el precio real que estas pagando.",
        read: "Barra larga con precio unitario bajo = el modelo es barato, simplemente lo usas mucho. Barra corta con precio unitario alto = ese modelo es caro y ahora mismo se nota poco solo porque lo usas poco.",
        act: "Cambia primero el que tenga la barra larga Y el precio unitario alto. Bajar el precio unitario de algo que apenas usas no ahorra nada.",
        source:
          "Consumo real reportado por cada proveedor (tokens del modelo, caracteres enviados al TTS) multiplicado por la tabla de precios del repositorio. En videos viejos el modelo puede faltar: se rescata del texto del detalle.",
      }}
      isEmpty={rows.length === 0}
      empty={empty}
      table={{
        columns: ["Modelo", "Proveedor", "USD", "MXN", "Consumo", "Precio efectivo", "Videos"],
        rows: withPrice.map(({ row, unitPrice }) => [
          row.model ?? "(sin especificar)",
          row.providerName,
          formatUsd(row.usd),
          formatMxn(row.mxn),
          row.units > 0 && row.unitKind ? `${compactNumber(row.units)} ${UNIT_LABELS[row.unitKind].plural}` : "—",
          unitPrice === null || !row.unitKind ? "—" : `${formatUsd(unitPrice)} ${UNIT_LABELS[row.unitKind].per}`,
          row.videos,
        ]),
      }}
    >
      <BarChart
        format={formatUsd}
        rows={withPrice.map(({ row, unitPrice }) => ({
          label: row.model ?? row.providerName,
          value: row.usd,
          display: formatUsd(row.usd),
          note:
            unitPrice !== null && row.unitKind
              ? `${formatUsd(unitPrice)} ${UNIT_LABELS[row.unitKind].per} · ${row.videos} video(s)`
              : `${row.videos} video(s)`,
        }))}
      />
    </ChartFrame>
  );
}

/**
 * Nube de puntos costo contra vistas.
 *
 * Es la unica forma que puede responder "no hay relacion", que aqui es la respuesta mas probable y
 * la mas util: significa que gastar mas no compra alcance, y que el dinero no es la palanca.
 */
function CostVsViewsChart({ rows }: { rows: CostEfficiencyRow[] }) {
  const points = rows
    .filter((r) => r.usd > 0 && r.views > 0)
    .map((r) => ({ x: r.usd, y: r.views, label: r.title ?? "(sin titulo)" }));

  return (
    <ChartFrame
      title="¿Gastar mas trae mas vistas?"
      description="Cada punto es un video: lo que costo producirlo contra las vistas que consiguio."
      howToRead={{
        measures: "El eje horizontal es el costo de produccion del video; el vertical, sus vistas. Un punto por video.",
        read: "Si los puntos forman una diagonal hacia arriba, gastar mas si trae mas vistas. Si forman una mancha sin direccion — que es lo normal — el costo no predice el alcance, y esa es la conclusion util: lo que decide es el gancho, no el presupuesto.",
        act: "Con una mancha, deja de optimizar el costo pensando en resultados y optimizalo por lo que es: ahorro. Los puntos muy a la derecha y muy abajo son videos caros que no funcionaron; mira que tenian en comun.",
        source: `Los ${SCATTER_LIMIT} videos mas eficientes con costo y vistas medidos. Los videos sin vistas medidas no pueden aparecer.`,
      }}
      isEmpty={points.length < 3}
      empty="Hacen falta al menos 3 videos con costo y vistas medidas para que una nube de puntos signifique algo."
      table={{
        columns: ["Video", "Costo", "Vistas"],
        rows: points.map((p) => [p.label, formatUsd(p.x), p.y.toLocaleString("es-MX")]),
      }}
    >
      <ScatterPlot points={points} xLabel="Costo de produccion (USD)" yLabel="Vistas" formatX={formatUsd} />
    </ChartFrame>
  );
}

/**
 * Costo por mil vistas, video a video.
 *
 * Ordenar por costo absoluto premiaria a los videos baratos que nadie vio. Esta grafica ordena por
 * lo que costo cada mil vistas conseguidas, que es lo que se puede comparar entre un video de hace
 * un ano y uno de la semana pasada.
 */
function EfficiencyChart({ rows }: { rows: CostEfficiencyRow[] }) {
  const ranked = rows
    .filter((r): r is CostEfficiencyRow & { usdPerThousandViews: number } => r.usdPerThousandViews !== null)
    .sort((a, b) => a.usdPerThousandViews - b.usdPerThousandViews);

  // Los diez mejores y los diez peores. El medio no aporta: la lectura util es el contraste.
  const shown = ranked.length <= 20 ? ranked : [...ranked.slice(0, 10), ...ranked.slice(-10)];
  const withoutViews = rows.filter((r) => r.usdPerThousandViews === null && r.usd > 0);

  return (
    <ChartFrame
      title="Costo por cada 1000 vistas, por video"
      description="De mas eficiente a menos."
      howToRead={{
        measures: "Lo que costo producir el video dividido entre las mil vistas que consiguio. Es la unica cifra que compara de forma justa un video de hace un ano con uno de la semana pasada.",
        read: "Arriba, los videos que rindieron el dinero. Abajo, los que no. Un costo alto por mil vistas no significa que el video fuera caro de hacer, sino que lo que costo no se convirtio en audiencia.",
        act: "Abre los ultimos de la lista y compara su gancho con los primeros. Si son igual de caros pero rinden diez veces menos, el problema esta en el guion, no en el presupuesto.",
        source: ranked.length > 20 ? "Se muestran los 10 mejores y los 10 peores; el resto esta en la tabla." : "Todos los videos con costo y vistas medidas.",
      }}
      isEmpty={ranked.length === 0}
      empty="Ningun video con costo tiene vistas medidas todavia. Vincula los videos a YouTube y sincroniza sus estadisticas."
      table={{
        columns: ["Video", "Costo por 1000 vistas", "Costo total", "Vistas"],
        rows: ranked.map((r) => [
          r.title ?? "(sin titulo)",
          formatUsd(r.usdPerThousandViews),
          formatUsd(r.usd),
          r.views.toLocaleString("es-MX"),
        ]),
      }}
    >
      <div className="space-y-3">
        <BarChart
          format={formatUsd}
          rows={shown.map((r) => ({
            label: r.title ?? "(sin titulo)",
            value: r.usdPerThousandViews,
            display: formatUsd(r.usdPerThousandViews),
            note: `${formatUsd(r.usd)} · ${compactNumber(r.views)} vistas`,
          }))}
        />
        {withoutViews.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {withoutViews.length} video(s) con costo quedan fuera porque no tienen vistas medidas.{" "}
            <Link href="/analytics" className="underline">
              Vincularlos a YouTube
            </Link>{" "}
            los incorpora.
          </p>
        )}
      </div>
    </ChartFrame>
  );
}

/**
 * Lo gratis se lista, no se grafica: son barras de cero, y su valor informativo es "esto no cuesta",
 * no una comparacion de magnitudes.
 */
function FreeProviders({ rows }: { rows: CostByModelRow[] }) {
  return (
    <section className="space-y-2 rounded-md border border-border p-4">
      <h3 className="text-sm font-semibold">Lo que no cuesta nada</h3>
      <p className="text-xs text-muted-foreground">
        Estos proveedores no aparecen en las graficas de arriba porque su costo es cero, no porque falten
        datos.
      </p>
      <ul className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={`${row.providerName}-${row.model ?? ""}`} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">
              {row.model && row.model !== row.providerName ? `${row.providerName} · ${row.model}` : row.providerName}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {row.isLocal ? "local" : "libre de derechos"} · {row.videos} video(s)
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
