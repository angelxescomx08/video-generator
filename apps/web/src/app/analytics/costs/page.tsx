import Link from "next/link";
import {
  effectiveUnitPrice,
  getChannelOverview,
  getCostByModel,
  getCostByMonth,
  getCostByStage,
  getCostEfficiency,
  getCostTotals,
  UNIT_LABELS,
  type CostByModelRow,
} from "@video-generator/analytics";
import { ChartFrame } from "@/components/charts/chart-frame";
import { BarChart, CompositionBar } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { HeroNumber, StatTile } from "@/components/charts/stat-tile";
import { compactNumber, formatMonth, formatMxn, formatUsd } from "@/components/charts/scales";
import { CostDisclaimer } from "@/components/cost-disclaimer";
import { STAGE_LABELS } from "@/lib/version-costs";

export const dynamic = "force-dynamic";

const COST_MONTHS = 12;

export default async function CostsPage() {
  const [totals, byStage, byModel, byMonth, efficiency, channel] = await Promise.all([
    getCostTotals(),
    getCostByStage(),
    getCostByModel(),
    getCostByMonth(COST_MONTHS),
    getCostEfficiency(15),
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
            hint="Incluye las regeneraciones: un video con tres versiones costo tres veces sus etapas repetidas."
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
            label="Etapas gratis"
            value={String(free.length)}
            hint="Proveedores locales (Ollama, Piper, ffmpeg) y stock libre de derechos."
          />
        </div>
      </section>

      <ChartFrame
        title="En que se va el dinero"
        description="Reparto del gasto entre las cinco etapas del pipeline, sumando todos los videos y todas sus versiones."
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

      <ModelChart
        title="Modelos de texto (guion y edicion)"
        description="Lo que ha costado cada modelo de lenguaje. Al lado va su precio efectivo por millon de tokens, que es lo unico que los compara de forma justa: un modelo puede encabezar el gasto solo porque se uso en los guiones mas largos."
        rows={textModels}
        empty="Ningun modelo de texto de pago ha generado costo todavia. Con Ollama en local, esta etapa es gratis."
      />

      <ModelChart
        title="Voces (TTS)"
        description="Lo que ha costado cada voz. El precio por millon de caracteres es el que decide: en Google, una voz Chirp3 HD cuesta casi ocho veces una Standard por el mismo guion."
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

      <ChartFrame
        title={`Gasto por mes (ultimos ${COST_MONTHS})`}
        description="Sale del total ya congelado en cada version al renderizarla, no de recalcular precios de hoy sobre videos viejos."
        isEmpty={byMonth.length < 2}
        empty="Hace falta mas de un mes con renders para dibujar una evolucion."
        table={{
          columns: ["Mes", "USD", "MXN", "Videos", "Versiones"],
          rows: byMonth.map((m) => [formatMonth(m.month), formatUsd(m.usd), formatMxn(m.mxn), m.videos, m.versions]),
        }}
      >
        <LineChart
          labels={byMonth.map((m) => formatMonth(m.month))}
          format={formatUsd}
          series={[{ label: "Gasto", values: byMonth.map((m) => m.usd), area: true }]}
        />
      </ChartFrame>

      <EfficiencyChart rows={efficiency} />

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
        gasto se convierte en vistas.
      </p>
    </div>
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
  const withPrice = rows.map((row) => ({
    row,
    unitPrice: effectiveUnitPrice(row.usd, row.units, row.unitKind),
  }));

  return (
    <ChartFrame
      title={title}
      description={description}
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
 * Costo por mil vistas, video a video: la pregunta de eficiencia de verdad.
 *
 * Ordenar por costo absoluto premiaria a los videos baratos que nadie vio. Esta grafica ordena por
 * lo que costo cada mil vistas conseguidas, que es lo que se puede comparar entre un video de hace
 * un ano y uno de la semana pasada.
 */
function EfficiencyChart({ rows }: { rows: Awaited<ReturnType<typeof getCostEfficiency>> }) {
  const ranked = rows
    .filter((r): r is typeof r & { usdPerThousandViews: number } => r.usdPerThousandViews !== null)
    .sort((a, b) => a.usdPerThousandViews - b.usdPerThousandViews);

  const withoutViews = rows.filter((r) => r.usdPerThousandViews === null && r.usd > 0);

  return (
    <ChartFrame
      title="Costo por cada 1000 vistas, por video"
      description="De mas eficiente a menos. Un costo alto por mil vistas no significa que el video fuera caro de hacer, sino que lo que costo no se convirtio en audiencia."
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
          rows={ranked.map((r) => ({
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
