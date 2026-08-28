import { db, videos } from "@/lib/db";
import { enqueueVideoGeneration } from "@/lib/queue";
import { createVideoRequestSchema, sanitizePromptText } from "@video-generator/types";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const rows = await db.select().from(videos).orderBy(desc(videos.createdAt)).limit(100);
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createVideoRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // El formulario ya limpia el texto, pero se repite aqui para que `videos.topic` nunca guarde
  // emojis/invisibles si alguien llama al endpoint directo — es lo que despues va al prompt del LLM.
  const topic = parsed.data.topic ? sanitizePromptText(parsed.data.topic).text || undefined : undefined;

  const [video] = await db
    .insert(videos)
    .values({
      themeId: parsed.data.themeId,
      format: parsed.data.format,
      topic,
      captionsEnabled: parsed.data.captionsEnabled,
      targetDurationSeconds: parsed.data.targetDurationSeconds,
      status: "queued",
    })
    .returning();

  await enqueueVideoGeneration(video!.id);

  return NextResponse.json(video, { status: 201 });
}
