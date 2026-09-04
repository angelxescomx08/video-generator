import Link from "next/link";
import {
  getDiscoveryReport,
  type DiscoveredDimensionDetail,
  type DiscoveryReport,
  type DiscoveryRunSummary,
  type DiscoveryVerdict,
} from "@video-generator/analytics";
import { ChartFrame } from "@/components/charts/chart-frame";
import { BarChart } from "@/components/charts/bar-chart";
import { StatTile } from "@/components/charts/stat-tile";

export const dynamic = "force-dynamic";

/**
 * Lo que la IA se pregunto sola, y en que quedo cada pregunta.
 *
 * Existe porque el descubrimiento producia resultado invisible: el boton de /analytics deja las
 * preguntas nuevas en `learning_dimensions`, pero el tablero solo enseña el `label` —el nombre
 * corto— y nada mas. La hipotesis exacta y el patron que la IA dijo haber visto quedaban solo en la
 * base, asi que apretar el boton se sentia igual que no apretarlo.
 *
 * Es pantalla aparte y no una seccion mas del tablero por la misma razon por la que costos vive
 * aparte: "¿que funciono?" y "¿que se esta preguntando el sistema y con cuanta evidencia?" son dos
 * preguntas distintas, y la segunda necesita el texto largo (pregunta, razonamiento, videos de cada
 * grupo) que ahogaria al tablero.
 */
export default async function DiscoveriesPage() {
  const report = await getDiscoveryReport();
  const active = report.dimensions.filter((d) => d.status === "active");
  const retired = report.dimensions.filter((d) => d.status !== "active");
  const withLearning = active.filter((d) => d.verdict === "con_leccion");
  const lastRun = report.runs[0];

  return (
    <div className="space-y-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Lo que la IA se pregunto sola</h1>
        <p className="text-sm text-muted-foreground">
          Cada tarjeta es una pregunta que <strong>no</strong> escribio nadie: la IA leyo los guiones que
          mejor y peor rindieron y propuso que valdria la pena medir. Lo unico que aporto es la
          hipotesis — si es cierta o no lo decide el mismo motor de datos que todo lo demas, con los
          mismos umbrales de muestra y de diferencia. Por eso una pregunta absurda no rompe nada: se
          queda sin veredicto para siempre y no llega al prompt.
        </p>
      </div>

      {report.dimensions.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Preguntas activas"
              value={String(active.length)}
              hint="Se miden en cada visita al tablero, junto a las escritas a mano."
            />
            <StatTile
              label="Con veredicto"
              value={`${withLearning.length} de ${active.length}`}
              hint={`Hace falta una brecha de ${report.minDeltaPoints} puntos entre grupos comparables.`}
            />
            <StatTile
              label="Muestra medible"
              value={String(report.sampleCount)}
              hint="Videos con vistas y dias suficientes. Es sobre estos que se decide, no sobre los clasificados."
            />
            <StatTile
              label="Ultimo analisis"
              value={lastRun ? formatDate(lastRun.startedAt) : "—"}
              hint={
                lastRun
                  ? `${lastRun.proposedCount} pregunta(s) sobre ${lastRun.sampleCount} videos (${lastRun.status}).`
                  : "Todavia no se ha corrido."
              }
            />
          </section>

          <section className="space-y-6">
            <div className="border-b border-border pb-2">
              <h2 className="text-lg font-semibold">Preguntas en curso</h2>
              <p className="text-sm text-muted-foreground">
                De la mas reciente a la mas antigua. Cada una trae el patron que la IA dijo ver, como
                quedaron repartidos tus videos y si eso ya alcanza para concluir algo.
              </p>
            </div>
            {active.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                No hay preguntas activas. Corre &quot;Buscar patrones nuevos&quot; desde el tablero de
                rendimiento.
              </p>
            ) : (
              active.map((dimension) => (
                <DimensionCard key={dimension.id} dimension={dimension} report={report} />
              ))
            )}
          </section>

          {retired.length > 0 && (
            <section className="space-y-6">
              <div className="border-b border-border pb-2">
                <h2 className="text-lg font-semibold">Preguntas retiradas</h2>
                <p className="text-sm text-muted-foreground">
                  Ya no se miden ni ocupan una de las ranuras activas. Se conservan con su
                  razonamiento: una hipotesis descartada explica por que no se volvio a intentar.
                </p>
              </div>
              {retired.map((dimension) => (
                <DimensionCard key={dimension.id} dimension={dimension} report={report} />
              ))}
            </section>
          )}

          <RunHistory runs={report.runs} />
        </>
      )}

      <p className="text-xs text-muted-foreground">
        ¿Buscas las lecciones que ya entran al prompt (incluidas las de las dimensiones escritas a
        mano)?{" "}
        <Link href="/analytics" className="underline">
          Estan en el tablero de rendimiento
        </Link>
        .
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <p className="font-medium">La IA todavia no ha propuesto ninguna pregunta</p>
      <p className="text-xs text-muted-foreground">
        El descubrimiento es manual y esta bloqueado hasta que aporte algo: hacen falta videos
        medibles suficientes para que &quot;los mejores&quot; y &quot;los peores&quot; no sean los mismos
        videos. El boton{" "}
        <Link href="/analytics" className="underline">
          Buscar patrones nuevos
        </Link>{" "}
        dice exactamente que falta cuando esta gris.
      </p>
    </div>
  );
}

/** Que significa cada veredicto y, sobre todo, que hacer con el. */
const VERDICT_COPY: Record<DiscoveryVerdict, { badge: string; tone: string; explain: (d: DiscoveredDimensionDetail, r: DiscoveryReport) => string }> = {
  con_leccion: {
    badge: "Con veredicto",
    tone: "border-foreground/40 bg-foreground/5",
    explain: () =>
      "La diferencia entre el mejor grupo y el peor ya es lo bastante grande y esta sostenida por suficientes videos. Esta leccion se le pasa a la IA al escribir el siguiente guion.",
  },
  sin_diferencia: {
    badge: "Sin diferencia",
    tone: "border-border bg-muted/30",
    explain: (_d, r) =>
      `Hay grupos comparables, pero se parecen demasiado: menos de ${r.minDeltaPoints} puntos entre el mejor y el peor. Esto es una respuesta, no un vacio — significa que esta pregunta probablemente no explica el rendimiento.`,
  },
  muestra_insuficiente: {
    badge: "Falta muestra",
    tone: "border-border bg-muted/30",
    explain: (_d, r) =>
      `Todavia no hay dos grupos que lleguen a ${r.minSamplesPerBucket} de peso efectivo. Se desbloquea publicando mas videos; con la muestra actual, cualquier diferencia seria casualidad.`,
  },
  sin_variacion: {
    badge: "Sin variacion",
    tone: "border-border bg-muted/30",
    explain: () =>
      "Todos tus videos cayeron en el mismo grupo, asi que no existe el grupo contra el cual comparar. Esto NO se arregla publicando mas de lo mismo: hace falta un video del otro tipo a proposito.",
  },
  sin_datos: {
    badge: "Sin datos",
    tone: "border-border bg-muted/30",
    explain: () =>
      "Ningun video de la muestra medible tiene etiqueta en esta pregunta. Suele pasar cuando la pregunta se creo despues de que se midieran los videos, o si el clasificador contesto algo fuera de las opciones.",
  },
};

function DimensionCard({ dimension, report }: { dimension: DiscoveredDimensionDetail; report: DiscoveryReport }) {
  const verdict = VERDICT_COPY[dimension.verdict];

  return (
    <article className={`space-y-4 rounded-md border p-4 ${verdict.tone}`}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{dimension.label}</h3>
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
            {verdict.badge}
          </span>
          <span className="text-[11px] text-muted-foreground">
            propuesta el {formatDate(dimension.createdAt)}
          </span>
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Pregunta que se le hace a cada guion: </span>
          <span className="font-medium">{dimension.question}</span>
        </p>
      </header>

      <details className="rounded-md border border-border bg-background/60 p-3">
        <summary className="cursor-pointer text-xs font-medium">
          El patron que la IA dijo ver al proponerla
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{dimension.rationale}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Esto es la HIPOTESIS, no una conclusion: la IA la escribio mirando 10 guiones sin medir
          nada. Lo que decide si era cierta es la comparacion de abajo.
        </p>
      </details>

      <ChartFrame
        title={`Como quedaron repartidos tus videos`}
        description={
          dimension.learning
            ? dimension.learning.insight
            : `Sin veredicto todavia. ${verdict.explain(dimension, report)}`
        }
        howToRead={{
          measures: `Cada grupo es una de las respuestas posibles a la pregunta. Se califica con su ${dimension.outcomeLabel} media, ponderada por recencia: un video reciente mueve el promedio mas que uno viejo.`,
          read: `La distancia entre la barra mas larga y la mas corta es la respuesta a la pregunta. Un grupo marcado "no entra" tiene menos de ${report.minSamplesPerBucket} de peso efectivo: se dibuja para que veas donde cayeron los videos, pero no participa en la comparacion.`,
          act: dimension.learning
            ? "Esta leccion ya se le esta pasando a la IA al escribir el siguiente guion. Si no estas de acuerdo, la forma de cambiarla es publicar videos del grupo perdedor y medirlos, no editar el prompt."
            : verdict.explain(dimension, report),
          source: `Un LLM leyo cada guion y contesto la pregunta con una de las opciones; esa etiqueta se guarda una vez por video. De los ${dimension.labeledVideos} videos clasificados, ${dimension.measurableVideos} tienen vistas y dias suficientes para medir.`,
        }}
        isEmpty={dimension.groups.length === 0}
        empty="Ningun video de la muestra medible tiene etiqueta en esta pregunta todavia."
        table={{
          columns: ["Grupo", dimension.outcomeLabel, "Videos", "Peso efectivo", "¿Compara?"],
          rows: dimension.groups.map((g) => [
            g.label,
            `${g.mean.toFixed(1)}%`,
            g.count,
            g.effectiveCount.toFixed(1),
            g.usable ? "si" : "no",
          ]),
        }}
      >
        <BarChart
          minAxisTop={100}
          rows={dimension.groups.map((g) => ({
            label: g.label,
            value: g.mean,
            note: g.usable ? `${g.count} video(s)` : `${g.count} video(s) — no entra, falta peso`,
            display: `${g.mean.toFixed(0)}%`,
          }))}
        />
      </ChartFrame>

      {dimension.groups.length > 0 && (
        <details className="rounded-md border border-border bg-background/60 p-3">
          <summary className="cursor-pointer text-xs font-medium">
            Que video cayo en cada grupo ({dimension.measurableVideos})
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Es la forma de auditar al clasificador: si un video esta claramente en el grupo
            equivocado, la pregunta esta mal planteada y su veredicto no vale — retirala en vez de
            creerle.
          </p>
          <div className="mt-3 space-y-3">
            {dimension.groups.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-medium">
                  {group.label}{" "}
                  <span className="font-normal text-muted-foreground">
                    — {group.mean.toFixed(1)}% de media
                  </span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {group.videos.map((video) => (
                    <li key={video.videoId} className="text-xs text-muted-foreground">
                      <Link href={`/videos/${video.videoId}`} className="underline">
                        {video.title}
                      </Link>{" "}
                      — {video.value.toFixed(1)}% (peso {video.weight.toFixed(2)})
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {dimension.unusedBuckets.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Respuestas que propuso y que ningun video recibio: {dimension.unusedBuckets.join(", ")}.
          Una opcion vacia tambien es informacion — o el canal nunca hace eso, o la opcion estaba mal
          definida.
        </p>
      )}
    </article>
  );
}

function RunHistory({ runs }: { runs: DiscoveryRunSummary[] }) {
  if (runs.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="border-b border-border pb-2">
        <h2 className="text-lg font-semibold">Analisis corridos</h2>
        <p className="text-sm text-muted-foreground">
          Sobre cuanta muestra se corrio cada vez. Es lo que hace que volver a apretar el boton con
          los mismos datos quede bloqueado: sin este registro no habria forma de distinguir &quot;hay
          material nuevo&quot; de &quot;es la misma muestra otra vez&quot;.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1 pr-3 text-left font-medium">Cuando</th>
              <th className="py-1 pr-3 text-left font-medium">Estado</th>
              <th className="py-1 pr-3 text-right font-medium">Videos mirados</th>
              <th className="py-1 pr-3 text-right font-medium">Preguntas nuevas</th>
              <th className="py-1 pr-3 text-right font-medium">Duro</th>
              <th className="py-1 text-left font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-3">{formatDateTime(run.startedAt)}</td>
                <td className="py-1.5 pr-3">{run.status}</td>
                <td className="py-1.5 pr-3 text-right">{run.sampleCount}</td>
                <td className="py-1.5 pr-3 text-right">{run.proposedCount}</td>
                <td className="py-1.5 pr-3 text-right">{formatDuration(run)}</td>
                <td className="py-1.5 text-muted-foreground">{run.errorMessage ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(run: DiscoveryRunSummary): string {
  if (!run.finishedAt) return "en curso";
  const seconds = Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
