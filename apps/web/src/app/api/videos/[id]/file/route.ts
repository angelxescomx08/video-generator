import { db, videos } from "@/lib/db";
import { eq } from "drizzle-orm";
import { createReadStream, statSync } from "node:fs";
import { NextResponse } from "next/server";
import { Readable } from "node:stream";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video?.renderOutputPath) return NextResponse.json({ error: "not rendered yet" }, { status: 404 });

  const stat = statSync(video.renderOutputPath);
  const stream = Readable.toWeb(createReadStream(video.renderOutputPath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
    },
  });
}
