import { db, publishedVideos } from "@/lib/db";
import { enqueueStatsPoll } from "@/lib/queue";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Boton "Jalar de YouTube": encola un poll de estadisticas para este video.
 *
 * Se encola en vez de llamar a la API de YouTube aqui mismo porque son cuatro requests a la Analytics
 * API mas uno a la Data API, con refresh de token de por medio — bloquear un request HTTP publico con
 * eso es justo lo que el worker existe para evitar. El handler de la cola ya sabe descifrar el token,
 * tolerar las metricas que falten y guardar el snapshot.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [published] = await db.select().from(publishedVideos).where(eq(publishedVideos.videoId, id)).limit(1);
  if (!published) {
    return NextResponse.json(
      { error: "el video no esta publicado todavia, no hay estadisticas que jalar" },
      { status: 409 },
    );
  }

  await enqueueStatsPoll(id);

  return NextResponse.json({ queued: true });
}
