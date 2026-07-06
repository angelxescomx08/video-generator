import { db, videoVersions, videos } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(videoVersions)
    .where(eq(videoVersions.videoId, id))
    .orderBy(desc(videoVersions.versionNumber));

  return NextResponse.json(rows.map((v) => ({ ...v, isCurrent: v.id === video.currentVersionId })));
}
