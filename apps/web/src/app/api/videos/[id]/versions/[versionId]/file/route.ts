import { db, videoVersions } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { createReadStream, statSync } from "node:fs";
import { NextResponse } from "next/server";
import { Readable } from "node:stream";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const version = await db.query.videoVersions.findFirst({
    where: and(eq(videoVersions.id, versionId), eq(videoVersions.videoId, id)),
  });
  if (!version) return NextResponse.json({ error: "version not found" }, { status: 404 });

  const stat = statSync(version.renderOutputPath);
  const stream = Readable.toWeb(createReadStream(version.renderOutputPath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
    },
  });
}
