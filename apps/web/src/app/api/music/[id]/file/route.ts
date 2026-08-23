import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { db, musicTracks } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Sirve el archivo de audio para poder escucharlo desde la biblioteca antes de usarlo. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const track = await db.query.musicTracks.findFirst({ where: eq(musicTracks.id, id) });
  if (!track) return NextResponse.json({ error: "track not found" }, { status: 404 });

  const stats = await stat(track.filePath).catch(() => null);
  if (!stats) return NextResponse.json({ error: "el archivo ya no existe en disco" }, { status: 404 });

  const stream = Readable.toWeb(createReadStream(track.filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": track.mimeType || "audio/mpeg",
      "Content-Length": String(stats.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
