import { db, publishedVideos, videoStats } from "@/lib/db";
import { manualStatsRequestSchema } from "@video-generator/types";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Ultimo snapshot de cada plataforma donde se publico el video, para pintar el formulario. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const rows = await db
    .select({ stats: videoStats, published: publishedVideos })
    .from(videoStats)
    .innerJoin(publishedVideos, eq(videoStats.publishedVideoId, publishedVideos.id))
    .where(eq(publishedVideos.videoId, id))
    .orderBy(desc(videoStats.capturedAt))
    .limit(50);

  return NextResponse.json(rows);
}

/**
 * Captura manual de estadisticas. Inserta un snapshot nuevo en vez de actualizar el ultimo: el
 * historico es lo que permite comparar dos videos a la misma edad, y sobrescribir lo destruiria.
 *
 * Solo se guardan los campos que el usuario realmente lleno. Un campo vacio queda en null ("todavia
 * no hay dato"), nunca en 0, porque el motor de aprendizaje descarta nulls pero leeria un 0 como
 * rendimiento nulo real.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = manualStatsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [published] = await db
    .select()
    .from(publishedVideos)
    .where(eq(publishedVideos.videoId, id))
    .orderBy(desc(publishedVideos.createdAt))
    .limit(1);

  if (!published) {
    return NextResponse.json(
      { error: "el video no esta publicado todavia, no hay estadisticas que registrar" },
      { status: 409 },
    );
  }

  const { notes, ...metrics } = parsed.data;
  const hasAnyMetric = Object.values(metrics).some((v) => v !== undefined);
  if (!hasAnyMetric && !notes) {
    return NextResponse.json({ error: "no se envio ninguna metrica" }, { status: 400 });
  }

  const [row] = await db
    .insert(videoStats)
    .values({
      publishedVideoId: published.id,
      source: "manual",
      videoAgeDays: daysSince(published.publishedAt),
      notes,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      impressions: metrics.impressions,
      engagedViews: metrics.engagedViews,
      subscribersGained: metrics.subscribersGained,
      avgViewDurationSeconds: numericOrNull(metrics.avgViewDurationSeconds),
      avgViewPercentage: numericOrNull(metrics.avgViewPercentage),
      watchTimeHours: numericOrNull(metrics.watchTimeHours),
      impressionsCtr: numericOrNull(metrics.impressionsCtr),
      stayedToWatchPercentage: numericOrNull(metrics.stayedToWatchPercentage),
      retentionAtStartPercentage: numericOrNull(metrics.retentionAtStartPercentage),
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function numericOrNull(value: number | undefined): string | null {
  return value === undefined ? null : value.toString();
}
