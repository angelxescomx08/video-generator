import { db, publishedVideos, videos } from "@/lib/db";
import { enqueuePublish } from "@/lib/queue";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NextResponse } from "next/server";

const bodySchema = z.object({
  platformAccountId: z.string().uuid(),
  /** El usuario ya vio la advertencia de que quedaran dos videos en el canal y aun asi quiere subirlo. */
  confirmDuplicate: z.boolean().optional(),
});

/** Estados desde los que tiene sentido publicar: el render ya termino. */
const PUBLISHABLE_STATUSES = new Set(["ready", "published", "failed"]);

/**
 * Si el worker esta caido, el video se quedaria en "publishing" para siempre y el boton no volveria
 * nunca. Pasado este tiempo se asume que ese intento se perdio y se permite reintentar.
 */
const STALE_PUBLISHING_MS = 15 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });
  if (!video.renderOutputPath) {
    return NextResponse.json({ error: "el video todavia no tiene un render que subir" }, { status: 409 });
  }

  // Guarda 1 — ya hay una subida en curso. Es la que cubre el doble click y las dos pestanas: sin
  // esto cada click encolaba un job nuevo y el worker podia acabar subiendo el mismo video varias
  // veces (sus propias guardas solo atrapan el caso en que la anterior YA termino).
  if (video.status === "publishing") {
    const age = Date.now() - new Date(video.updatedAt).getTime();
    if (age < STALE_PUBLISHING_MS) {
      return NextResponse.json(
        { error: "Ya hay una publicacion en curso para este video.", code: "publish_in_progress" },
        { status: 409 },
      );
    }
  } else if (!PUBLISHABLE_STATUSES.has(video.status)) {
    return NextResponse.json(
      { error: "el video se esta generando, espera a que termine", code: "not_ready" },
      { status: 409 },
    );
  }

  // Guarda 2 — ya existe una publicacion en esa cuenta. Se puede forzar, pero solo a proposito.
  const existing = await db.query.publishedVideos.findFirst({
    where: and(eq(publishedVideos.videoId, id), eq(publishedVideos.platformAccountId, parsed.data.platformAccountId)),
  });
  if (existing && !parsed.data.confirmDuplicate) {
    return NextResponse.json(
      {
        error: "Este video ya esta publicado en esa cuenta.",
        code: "already_published",
        externalVideoId: existing.externalVideoId,
        externalUrl: existing.externalUrl,
      },
      { status: 409 },
    );
  }

  // Se marca "publishing" aqui y no al recoger el job para que la UI lo refleje de inmediato y el
  // boton quede bloqueado tambien del lado del servidor mientras el worker no lo toma.
  await db
    .update(videos)
    .set({ status: "publishing", errorMessage: null, updatedAt: new Date() })
    .where(eq(videos.id, id));

  await enqueuePublish(id, parsed.data.platformAccountId);
  return NextResponse.json({ ok: true, status: "publishing" });
}
