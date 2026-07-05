import { db, videos } from "@/lib/db";
import { enqueueVideoGeneration } from "@/lib/queue";
import { createVideoRequestSchema } from "@video-generator/types";
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

  const [video] = await db
    .insert(videos)
    .values({
      themeId: parsed.data.themeId,
      format: parsed.data.format,
      topic: parsed.data.topic,
      status: "queued",
    })
    .returning();

  await enqueueVideoGeneration(video!.id);

  return NextResponse.json(video, { status: 201 });
}
