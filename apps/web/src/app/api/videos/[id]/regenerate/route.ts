import { db, feedback, videos, generationJobs } from "@/lib/db";
import { enqueueVideoGeneration, enqueueVideoResume } from "@/lib/queue";
import { regenerateVideoRequestSchema } from "@video-generator/types";
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

  // Sin feedback nuevo: si fallo a medio pipeline, reanuda en ese stage en vez de rehacer
  // guion/tts/etc ya completados (evita gastar cuota de IA/TTS de nuevo).
  if (!parsed.data.feedbackId && video.status === "failed") {
    const [lastFailedJob] = await db
      .select({ jobType: generationJobs.jobType })
      .from(generationJobs)
      .where(and(eq(generationJobs.videoId, id), eq(generationJobs.status, "failed")))
      .orderBy(desc(generationJobs.createdAt))
      .limit(1);

    if (lastFailedJob) {
      await enqueueVideoResume(id, lastFailedJob.jobType);
      return NextResponse.json(updated);
    }
  }

  await enqueueVideoGeneration(id);

  return NextResponse.json(updated);
}
