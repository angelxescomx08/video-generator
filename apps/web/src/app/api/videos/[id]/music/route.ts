import { db, musicTracks, videos } from "@/lib/db";
import { getBoss, QUEUES } from "@video-generator/queue";
import {
  backgroundMusicDbFor,
  BACKGROUND_MUSIC_LEVELS,
  type EditDecisionList,
} from "@video-generator/types";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const RE_RENDERABLE_STATUSES = new Set(["ready", "published", "failed"]);

const changeMusicSchema = z.object({
  /** null = quitar la musica y dejar el video solo con la narracion. */
  musicTrackId: z.string().uuid().nullable(),
  level: z.enum(BACKGROUND_MUSIC_LEVELS.map((l) => l.id) as [string, ...string[]]).optional(),
});

/**
 * Cambia la musica de fondo de un video y lo re-renderiza como una version nueva.
 *
 * Solo encola RENDER_VIDEO, no la generacion completa: el guion, la voz y los clips ya estan en la
 * base y no cambian, asi que no se gasta ni una llamada al LLM ni al TTS — solo corre ffmpeg. Cada
 * cambio queda como una version aparte, asi que se puede volver a la anterior (con otra cancion o
 * sin musica) desde el panel de versiones.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = changeMusicSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });
  if (!RE_RENDERABLE_STATUSES.has(video.status)) {
    return NextResponse.json({ error: "el video esta generandose, espera a que termine" }, { status: 409 });
  }

  const edl = video.edl as EditDecisionList | null;
  if (!edl) {
    return NextResponse.json(
      { error: "el video todavia no tiene un EDL renderizable; generalo primero" },
      { status: 409 },
    );
  }

  let track = null;
  if (parsed.data.musicTrackId) {
    track = await db.query.musicTracks.findFirst({ where: eq(musicTracks.id, parsed.data.musicTrackId) });
    if (!track) return NextResponse.json({ error: "track not found" }, { status: 404 });
  }

  const nextEdl: EditDecisionList = {
    ...edl,
    audio: {
      ...edl.audio,
      backgroundMusicPath: track?.filePath,
      backgroundMusicTrackId: track?.id,
      backgroundMusicLabel: track ? [track.title, track.artist].filter(Boolean).join(" — ") : undefined,
      backgroundMusicVolumeDb: track ? backgroundMusicDbFor(parsed.data.level) : undefined,
    },
  };

  await db
    .update(videos)
    .set({ edl: nextEdl, status: "rendering", errorMessage: null, updatedAt: new Date() })
    .where(eq(videos.id, id));

  const boss = await getBoss();
  await boss.send(QUEUES.RENDER_VIDEO, { videoId: id });

  return NextResponse.json({ queued: true, music: nextEdl.audio.backgroundMusicLabel ?? null });
}
