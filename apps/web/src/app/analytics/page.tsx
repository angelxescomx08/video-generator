import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { db, publishedVideos, videoStats, videos } from "@/lib/db";
import { desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { SyncAllStatsButton } from "@/components/sync-all-stats-button";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [latestStats, linked, unlinked] = await Promise.all([
    latestSnapshotPerVideo(),
    db.select().from(publishedVideos),
    unlinkedPublishableVideos(),
  ]);

  const usableLinks = linked.filter((l) => l.status === "published");
  const brokenLinks = linked.filter((l) => l.status === "failed");

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          El rendimiento real de cada video publicado. Se sincroniza solo cada 6 horas (job{" "}
          <code>poll-stats</code> del worker), y de aqui sale el aprendizaje que la IA aplica a todos los
          temas.
        </p>
      </div>

      <SyncAllStatsButton linkedCount={usableLinks.length} />

      {brokenLinks.length > 0 && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          {brokenLinks.length} video(s) tienen un vinculo de YouTube invalido y se estan omitiendo. Entra a
          su pantalla de rendimiento para corregirlo.
        </p>
      )}

      {latestStats.length === 0 ? (
        <EmptyState hasLinks={usableLinks.length > 0} />
      ) : (
        <StatsTable rows={latestStats} />
      )}

      {unlinked.length > 0 && <UnlinkedVideos videos={unlinked} />}
    </div>
  );
}

/**
 * El snapshot mas reciente de cada video, no los ultimos 50 snapshots.
 *
 * La version anterior de esta pantalla ordenaba `video_stats` por fecha y cortaba en 50, asi que un
 * solo video con historial largo llenaba la tabla entera y ocultaba a los demas — y ademas mostraba
 * el mismo video repetido con sus mediciones de distintos dias, que se leia como si fueran videos
 * distintos.
 */
async function latestSnapshotPerVideo() {
  return db
    .selectDistinctOn([publishedVideos.videoId], {
      videoId: videos.id,
      videoTitle: videos.title,
      platform: publishedVideos.platform,
      externalUrl: publishedVideos.externalUrl,
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
}

/** Videos ya renderizados que todavia no estan vinculados a un video de YouTube. */
async function unlinkedPublishableVideos() {
  const linkedIds = await db.select({ videoId: publishedVideos.videoId }).from(publishedVideos);
  const ids = linkedIds.map((r) => r.videoId);

  return db
    .select({ id: videos.id, title: videos.title, status: videos.status })
    .from(videos)
    .where(
      ids.length > 0
        ? notInArray(videos.id, ids)
        : inArray(videos.status, ["ready", "published"]),
    )
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

function StatsTable({ rows }: { rows: Awaited<ReturnType<typeof latestSnapshotPerVideo>> }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Las columnas marcadas como clave son las que alimentan el aprendizaje de la IA. Un guion se juzga
        por la retencion; el titulo y la miniatura, por el CTR.
      </p>
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
                    <Link href={`/videos/${row.videoId}/performance`} className="hover:underline">
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
                <td className="p-3 text-xs text-muted-foreground">
                  {row.capturedAt.toLocaleString("es-MX")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
