import { db, videoVersions, videos } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const REVERTIBLE_STATUSES = new Set(["ready", "failed", "published"]);

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;

  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });
  if (!REVERTIBLE_STATUSES.has(video.status)) {
    return NextResponse.json({ error: "video generation is in progress" }, { status: 409 });
  }

  const version = await db.query.videoVersions.findFirst({
    where: and(eq(videoVersions.id, versionId), eq(videoVersions.videoId, id)),
  });
  if (!version) return NextResponse.json({ error: "version not found" }, { status: 404 });

  const [updated] = await db
    .update(videos)
    .set({
      script: version.script,
      scenes: version.scenes,
      sceneAudio: version.sceneAudio,
      sceneClips: version.sceneClips,
      edl: version.edl,
      renderOutputPath: version.renderOutputPath,
      durationSeconds: version.durationSeconds,
      status: "ready",
      errorMessage: null,
      currentVersionId: version.id,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, id))
    .returning();

  return NextResponse.json(updated);
}
