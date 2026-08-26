import { db, publishedVideos } from "@/lib/db";
import { enqueueStatsPoll } from "@/lib/queue";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Sincroniza las analiticas de TODOS los videos vinculados, a demanda. Es el mismo trabajo que corre
 * el cron cada 6 horas; este boton solo lo adelanta para no tener que esperar la siguiente vuelta.
 */
export async function POST() {
  const linked = await db
    .select({ id: publishedVideos.id })
    .from(publishedVideos)
    .where(eq(publishedVideos.status, "published"));

  if (linked.length === 0) {
    return NextResponse.json(
      { error: "no hay videos vinculados a YouTube todavia" },
      { status: 409 },
    );
  }

  await enqueueStatsPoll();

  return NextResponse.json({ queued: true, videos: linked.length });
}
