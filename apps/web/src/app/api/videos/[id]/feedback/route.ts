import { resolveEmbeddingProvider } from "@video-generator/ai-providers";
import { db, feedback, videoMemory, videos } from "@/lib/db";
import { createFeedbackRequestSchema } from "@video-generator/types";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = createFeedbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });

  const [row] = await db
    .insert(feedback)
    .values({
      videoId: id,
      themeId: video.themeId,
      rating: parsed.data.rating,
      structuredRatings: parsed.data.structuredRatings,
      comment: parsed.data.comment,
      source: "manual",
    })
    .returning();

  // Embed immediately so the next script generation for this theme picks it up via the same
  // pgvector similarity search used for past scripts (see apps/worker/src/memory/retrieve.ts).
  if (parsed.data.comment) {
    const embeddingProvider = await resolveEmbeddingProvider();
    const embedding = await embeddingProvider.embed({ text: parsed.data.comment });
    await db.insert(videoMemory).values({
      themeId: video.themeId,
      videoId: id,
      contentType: "feedback_summary",
      content: parsed.data.comment,
      embedding,
      metadata: { rating: parsed.data.rating },
    });
  }

  return NextResponse.json(row, { status: 201 });
}
