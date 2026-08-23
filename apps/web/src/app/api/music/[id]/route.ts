import { unlink } from "node:fs/promises";
import { db, musicTracks, videos } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Borra una pista de la biblioteca y su archivo.
 *
 * Se niega si algun video la tiene puesta como musica de fondo: borrar el archivo dejaria ese EDL
 * apuntando a una ruta inexistente y el siguiente render de esa version fallaria.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const track = await db.query.musicTracks.findFirst({ where: eq(musicTracks.id, id) });
  if (!track) return NextResponse.json({ error: "track not found" }, { status: 404 });

  const allVideos = await db.select({ id: videos.id, title: videos.title, edl: videos.edl }).from(videos);
  const inUse = allVideos.filter(
    (v) => (v.edl as { audio?: { backgroundMusicTrackId?: string } } | null)?.audio?.backgroundMusicTrackId === id,
  );
  if (inUse.length > 0) {
    return NextResponse.json(
      {
        error: `La cancion esta en uso por ${inUse.length} video(s). Cambiales la musica antes de borrarla.`,
        videos: inUse.map((v) => ({ id: v.id, title: v.title })),
      },
      { status: 409 },
    );
  }

  await db.delete(musicTracks).where(eq(musicTracks.id, id));
  // Si el archivo ya no existe la fila igual queda borrada: el objetivo es que no aparezca mas.
  await unlink(track.filePath).catch(() => undefined);

  return NextResponse.json({ deleted: true });
}
