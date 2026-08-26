import { db, videos } from "@/lib/db";
import { getBoss, QUEUES } from "@video-generator/queue";
import type { EditDecisionList } from "@video-generator/types";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const RE_RENDERABLE_STATUSES = new Set(["ready", "published", "failed"]);

/**
 * Vuelve a renderizar el video sin cambiar NADA de su contenido.
 *
 * Existe para aplicar mejoras del propio render (arreglos de ffmpeg, subtitulos, efectos) a videos ya
 * generados. Hasta ahora el unico camino que encolaba RENDER_VIDEO desde la web era cambiar la musica,
 * asi que para aprovechar un arreglo del render habia que cambiar la cancion a proposito o regenerar
 * todo desde el guion — gastando LLM y TTS de nuevo sin necesidad.
 *
 * No toca el EDL: guion, voz y clips se reutilizan tal cual, asi que el costo es solo el de ffmpeg.
 * El resultado queda como una version nueva, asi que la anterior se puede recuperar desde el panel de
 * versiones si el render nuevo saliera peor.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });

  if (!RE_RENDERABLE_STATUSES.has(video.status)) {
    return NextResponse.json({ error: "el video esta generandose, espera a que termine" }, { status: 409 });
  }

  const edl = video.edl as EditDecisionList | null;
  if (!edl) {
    return NextResponse.json(
      { error: "este video no tiene un EDL todavia, no hay nada que re-renderizar" },
      { status: 409 },
    );
  }

  // Los archivos de trabajo (voz y clips) viven en data/tmp y se pueden haber limpiado; si faltan, el
  // render fallara con un ENOENT claro desde ffmpeg y el video quedara en 'failed' con su mensaje.
  await db
    .update(videos)
    .set({ status: "rendering", errorMessage: null, updatedAt: new Date() })
    .where(eq(videos.id, id));

  const boss = await getBoss();
  await boss.send(QUEUES.RENDER_VIDEO, { videoId: id });

  return NextResponse.json({ queued: true });
}
