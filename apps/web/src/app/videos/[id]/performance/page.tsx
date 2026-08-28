import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { db, publishedVideos, videoStats, videos, type VideoStats } from "@/lib/db";
import { CRITICAL_METRIC_KEYS, MIN_DAYS_FOR_LEARNING, MIN_VIEWS_FOR_LEARNING } from "@video-generator/types";
import { Badge } from "@/components/ui/badge";
import { PerformanceForm, type InitialMetrics } from "@/components/performance-form";
import { LinkYoutubeForm } from "@/components/link-youtube-form";

export const dynamic = "force-dynamic";

export default async function VideoPerformancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) notFound();

  const [published] = await db
    .select()
    .from(publishedVideos)
    .where(eq(publishedVideos.videoId, id))
    .orderBy(desc(publishedVideos.createdAt))
    .limit(1);

  const history = published
    ? await db
        .select()
        .from(videoStats)
        .where(eq(videoStats.publishedVideoId, published.id))
        .orderBy(desc(videoStats.capturedAt))
        .limit(20)
    : [];

  const latest = history[0];

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-3">
        <Link
          href={`/videos/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver al video
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Como le fue</h1>
            <p className="text-sm text-muted-foreground">{video.title ?? "Video sin titulo"}</p>
          </div>
          <Link href={`/videos/${id}/analytics`} className="text-xs text-muted-foreground underline hover:text-foreground">
            Ver las graficas
          </Link>
        </div>
      </div>

      <HowItLearns />

      {!published && <LinkYoutubeForm videoId={id} />}

      {published?.status === "failed" && (
        <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm font-medium">El vinculo con YouTube no es valido</p>
          <p className="text-xs text-muted-foreground">
            YouTube no encuentra el video <code className="font-medium">{published.externalVideoId}</code> para
            la cuenta conectada. Suele ser un ID de otro canal, un enlace mal copiado o un video borrado. Para
            corregirlo, vincula el video correcto desde la base de datos o borra esta fila de{" "}
            <code>published_videos</code>.
          </p>
        </div>
      )}

      {published && published.status !== "failed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
          <Badge variant="secondary" className="text-[10px]">
            Vinculado
          </Badge>
          <code className="text-xs">{published.externalVideoId}</code>
          <span className="text-xs text-muted-foreground">
            {published.publishedAt
              ? `publicado el ${published.publishedAt.toLocaleDateString("es-MX")}`
              : "fecha de publicacion pendiente (se rellena en la primera sincronizacion)"}
          </span>
          {published.externalUrl && (
            <a
              href={published.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Abrir en YouTube
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      <PerformanceForm
        videoId={id}
        canPullFromApi={Boolean(published) && published?.status !== "failed"}
        initialMetrics={toInitialMetrics(latest)}
      />

      {history.length > 0 && <SnapshotHistory history={history} />}
    </div>
  );
}

/**
 * Explica el contrato de esta pantalla antes de pedir datos. Sin esto, lo natural es llenar
 * visualizaciones y likes (que no ensenan nada) y dejar en blanco la retencion (que es lo unico que
 * la IA puede usar), asi que decir de entrada que metricas mueven la aguja es parte de la funcion.
 */
function HowItLearns() {
  return (
    <section className="space-y-2 rounded-md border border-border bg-muted/40 p-4">
      <h2 className="text-sm font-semibold">Que hace la IA con esto</h2>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        <li>
          Cada video se guarda junto con <span className="font-medium text-foreground">como se hizo</span>{" "}
          (tipo de gancho, ritmo de narracion, numero de escenas, duracion, musica, subtitulos). Al cruzar eso
          contra el rendimiento sale el aprendizaje real: no &quot;a este video le fue mal&quot; sino
          &quot;a los videos con gancho narrado largo les va mal&quot;.
        </li>
        <li>
          El aprendizaje es <span className="font-medium text-foreground">global</span>: los patrones se
          calculan sobre todos los temas del canal y se aplican al escribir cualquier guion, porque como se
          engancha a alguien en 3 segundos no depende del tema.
        </li>
        <li>
          Solo las metricas marcadas como{" "}
          <Badge variant="default" className="text-[10px]">
            Clave
          </Badge>{" "}
          entran al analisis ({CRITICAL_METRIC_KEYS.length} de ellas). El resto se guarda como contexto.
        </li>
        <li>
          Se ignoran los videos con menos de{" "}
          <span className="font-medium text-foreground">{MIN_VIEWS_FOR_LEARNING} visualizaciones</span> o con
          menos de <span className="font-medium text-foreground">{MIN_DAYS_FOR_LEARNING} dias</span>{" "}
          publicados: antes de eso YouTube sigue repartiendo impresiones y los porcentajes se mueven enteros
          con un solo espectador.
        </li>
        <li>
          Un campo que dejes vacio queda como &quot;sin dato&quot; y se descarta, no como cero. Es mejor
          dejarlo en blanco que inventar un numero.
        </li>
      </ul>
    </section>
  );
}

function SnapshotHistory({ history }: { history: VideoStats[] }) {
  return (
    <section className="space-y-3">
      <div className="border-b border-border pb-2">
        <h2 className="text-lg font-semibold">Historial de capturas</h2>
        <p className="text-sm text-muted-foreground">
          Cada captura es una foto del momento y no se sobrescribe: es lo que permite comparar dos videos a
          la misma edad.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Fecha</th>
              <th className="py-2 pr-4 font-medium">Origen</th>
              <th className="py-2 pr-4 font-medium">Edad</th>
              <th className="py-2 pr-4 font-medium">Views</th>
              <th className="py-2 pr-4 font-medium">Ret. 3s</th>
              <th className="py-2 pr-4 font-medium">% visto</th>
              <th className="py-2 pr-4 font-medium">Curva</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.id} className="border-b border-border/50">
                <td className="py-2 pr-4 tabular-nums">{row.capturedAt.toLocaleDateString("es-MX")}</td>
                <td className="py-2 pr-4">
                  <Badge variant={row.source === "api" ? "secondary" : "outline"} className="text-[10px]">
                    {row.source === "api" ? "API" : "Manual"}
                  </Badge>
                </td>
                <td className="py-2 pr-4 tabular-nums">
                  {row.videoAgeDays === null ? "—" : `${row.videoAgeDays}d`}
                </td>
                <td className="py-2 pr-4 tabular-nums">{row.views ?? "—"}</td>
                <td className="py-2 pr-4 tabular-nums">{percent(row.retentionAtStartPercentage)}</td>
                <td className="py-2 pr-4 tabular-nums">{percent(row.avgViewPercentage)}</td>
                <td className="py-2 pr-4">{row.retentionCurve ? "si" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function percent(value: string | null): string {
  if (value === null) return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : "—";
}

/** Precarga el formulario con el ultimo snapshot para poder corregirlo en vez de reescribirlo. */
function toInitialMetrics(latest: VideoStats | undefined): InitialMetrics {
  if (!latest) return {};
  return dropUndefined({
    views: latest.views ?? undefined,
    likes: latest.likes ?? undefined,
    comments: latest.comments ?? undefined,
    shares: latest.shares ?? undefined,
    impressions: latest.impressions ?? undefined,
    engagedViews: latest.engagedViews ?? undefined,
    subscribersGained: latest.subscribersGained ?? undefined,
    avgViewDurationSeconds: toNumber(latest.avgViewDurationSeconds),
    avgViewPercentage: toNumber(latest.avgViewPercentage),
    watchTimeHours: toNumber(latest.watchTimeHours),
    impressionsCtr: toNumber(latest.impressionsCtr),
    stayedToWatchPercentage: toNumber(latest.stayedToWatchPercentage),
    retentionAtStartPercentage: toNumber(latest.retentionAtStartPercentage),
  });
}

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dropUndefined(metrics: Record<string, number | undefined>): InitialMetrics {
  return Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== undefined));
}
