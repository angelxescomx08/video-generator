import { db, feedback, videos, generationJobs, platformAccounts, publishedVideos } from "@/lib/db";
import { enqueuePublish, enqueueVideoGeneration, enqueueVideoResume } from "@/lib/queue";
import { regenerateVideoRequestSchema } from "@video-generator/types";
import type { JobType } from "@video-generator/db";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const REGENERABLE_STATUSES = new Set(["ready", "failed", "published"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = regenerateVideoRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });
  if (!REGENERABLE_STATUSES.has(video.status)) {
    return NextResponse.json({ error: "video generation is already in progress" }, { status: 409 });
  }

  if (parsed.data.feedbackId) {
    const feedbackRow = await db.query.feedback.findFirst({
      where: and(eq(feedback.id, parsed.data.feedbackId), eq(feedback.videoId, id)),
    });
    if (!feedbackRow) return NextResponse.json({ error: "feedback not found for this video" }, { status: 404 });
  }

  // Sin feedback nuevo: si fallo a medio pipeline, reanuda en ese stage en vez de rehacer
  // guion/tts/etc ya completados (evita gastar cuota de IA/TTS de nuevo).
  let resumeStage: JobType | undefined;
  if (!parsed.data.feedbackId && video.status === "failed") {
    const [lastFailedJob] = await db
      .select({ jobType: generationJobs.jobType })
      .from(generationJobs)
      .where(and(eq(generationJobs.videoId, id), eq(generationJobs.status, "failed")))
      .orderBy(desc(generationJobs.createdAt))
      .limit(1);
    resumeStage = lastFailedJob?.jobType;
  }

  // `publish` necesita saber A QUE CUENTA subir; los demas stages solo llevan el videoId. Se resuelve
  // ANTES de tocar el estado del video: si no se puede, no hay que deshacer nada. Reintentar sin
  // cuenta dejaba al video en 'queued' con el worker muerto en el zod.parse.
  let publishAccountId: string | undefined;
  if (resumeStage === "publish") {
    publishAccountId = await resolvePublishAccount(id);
    if (!publishAccountId) {
      return NextResponse.json(
        {
          error:
            "no se pudo deducir a que cuenta publicar. Elige la cuenta en el panel de publicacion del video.",
        },
        { status: 409 },
      );
    }
  }

  const [updated] = await db
    .update(videos)
    .set({
      status: "queued",
      errorMessage: null,
      pendingFeedbackId: parsed.data.feedbackId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, id))
    .returning();

  if (publishAccountId) {
    await enqueuePublish(id, publishAccountId);
    return NextResponse.json(updated);
  }

  if (resumeStage) {
    await enqueueVideoResume(id, resumeStage);
    return NextResponse.json(updated);
  }

  await enqueueVideoGeneration(id);

  return NextResponse.json(updated);
}

/**
 * Cuenta destino para reintentar una publicacion. Devuelve `undefined` cuando es ambigua en vez de
 * elegir una: subir al canal equivocado no se deshace, y en ese caso el panel de publicacion ya deja
 * escogerla a mano.
 */
async function resolvePublishAccount(videoId: string): Promise<string | undefined> {
  // Si ya hubo un intento registrado, el reintento va a ESA cuenta.
  const previous = await db.query.publishedVideos.findFirst({
    where: eq(publishedVideos.videoId, videoId),
  });
  if (previous) return previous.platformAccountId;

  const active = await db
    .select({ id: platformAccounts.id })
    .from(platformAccounts)
    .where(eq(platformAccounts.isActive, true));
  return active.length === 1 ? active[0]!.id : undefined;
}
