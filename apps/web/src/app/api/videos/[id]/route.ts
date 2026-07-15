import {
  db,
  videos,
  videoVersions,
  generationJobs,
  feedback,
  publishedVideos,
  videoStats,
  videoMemory,
  generationHistory,
} from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(video);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "not found" }, { status: 404 });

  const versions = await db
    .select({ renderOutputPath: videoVersions.renderOutputPath })
    .from(videoVersions)
    .where(eq(videoVersions.videoId, id));

  await db.transaction(async (tx) => {
    const published = await tx
      .select({ id: publishedVideos.id })
      .from(publishedVideos)
      .where(eq(publishedVideos.videoId, id));
    const publishedIds = published.map((p) => p.id);

    if (publishedIds.length > 0) {
      await tx.delete(videoStats).where(inArray(videoStats.publishedVideoId, publishedIds));
    }
    await tx.delete(publishedVideos).where(eq(publishedVideos.videoId, id));
    await tx.delete(videoVersions).where(eq(videoVersions.videoId, id));
    await tx.delete(feedback).where(eq(feedback.videoId, id));
    await tx.delete(generationJobs).where(eq(generationJobs.videoId, id));
    // video_memory/generation_history son hechos a nivel de tema (dedup entre generaciones);
    // se desvincula el video en vez de borrarlos para no perder ese historial.
    await tx.update(videoMemory).set({ videoId: null }).where(eq(videoMemory.videoId, id));
    await tx.update(generationHistory).set({ videoId: null }).where(eq(generationHistory.videoId, id));
    await tx.delete(videos).where(eq(videos.id, id));
  });

  const outputPaths = [video.renderOutputPath, ...versions.map((v) => v.renderOutputPath)].filter(
    (p): p is string => Boolean(p),
  );
  await Promise.all(
    outputPaths.map((p) =>
      unlink(p).catch(() => {
        // best-effort: el archivo puede ya no existir en disco
      }),
    ),
  );

  return new NextResponse(null, { status: 204 });
}
