import Link from "next/link";
import { db, videos, themes } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const rows = await db
    .select({ video: videos, themeName: themes.name })
    .from(videos)
    .leftJoin(themes, eq(videos.themeId, themes.id))
    .orderBy(desc(videos.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Videos</h1>
        <Link href="/videos/new">
          <Button>Nuevo video</Button>
        </Link>
      </div>

      {rows.length === 0 && (
        <p className="text-muted-foreground">Todavia no hay videos. Crea el primero.</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ video, themeName }) => (
          <Link key={video.id} href={`/videos/${video.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="line-clamp-1 text-base">{video.title ?? "(sin titulo aun)"}</CardTitle>
                  <Badge variant={statusVariant(video.status)}>{video.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p>Tema: {themeName ?? "-"}</p>
                <p>Formato: {video.format}</p>
                <p>Creado: {new Date(video.createdAt).toLocaleString()}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
