import { db, publishedVideos, videoStats, videos } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const latestStats = await db
    .select({
      videoTitle: videos.title,
      platform: publishedVideos.platform,
      externalUrl: publishedVideos.externalUrl,
      views: videoStats.views,
      likes: videoStats.likes,
      comments: videoStats.comments,
      avgViewPercentage: videoStats.avgViewPercentage,
      capturedAt: videoStats.capturedAt,
    })
    .from(videoStats)
    .innerJoin(publishedVideos, eq(videoStats.publishedVideoId, publishedVideos.id))
    .innerJoin(videos, eq(publishedVideos.videoId, videos.id))
    .orderBy(desc(videoStats.capturedAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="text-sm text-muted-foreground">
        Estadisticas mas recientes por video publicado. Se actualizan automaticamente cada 6 horas
        (job <code>poll-stats</code> en el worker).
      </p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="p-3">Video</th>
              <th className="p-3">Plataforma</th>
              <th className="p-3">Vistas</th>
              <th className="p-3">Likes</th>
              <th className="p-3">Comentarios</th>
              <th className="p-3">Retencion %</th>
              <th className="p-3">Capturado</th>
            </tr>
          </thead>
          <tbody>
            {latestStats.map((row, i) => (
              <tr key={i} className="border-t border-border">
                <td className="p-3">{row.videoTitle ?? "-"}</td>
                <td className="p-3 capitalize">{row.platform}</td>
                <td className="p-3">{row.views}</td>
                <td className="p-3">{row.likes}</td>
                <td className="p-3">{row.comments}</td>
                <td className="p-3">{row.avgViewPercentage ?? "-"}</td>
                <td className="p-3">{new Date(row.capturedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {latestStats.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">Aun no hay estadisticas capturadas.</p>
        )}
      </div>
    </div>
  );
}
