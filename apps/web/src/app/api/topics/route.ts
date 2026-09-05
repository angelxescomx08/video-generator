import { db } from "@/lib/db";
import { enqueueTopicDiscovery } from "@/lib/queue";
import { topicProposals } from "@video-generator/db";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const discoverRequestSchema = z.object({
  themeId: z.string().uuid(),
  /** Consulta libre. Vacia = el worker deriva una del nombre del tema. */
  query: z.string().max(300).optional(),
});

export async function GET() {
  const rows = await db.select().from(topicProposals).orderBy(desc(topicProposals.createdAt)).limit(100);
  return NextResponse.json(rows);
}

/**
 * Encola una busqueda de temas. El trabajo real (buscar en la web, llamar al LLM y comprobar
 * repetidos con embeddings) lo hace el worker: esta ruta solo valida y encola, porque `apps/web`
 * nunca debe bloquear un request esperando a un LLM.
 */
export async function POST(request: Request) {
  const parsed = discoverRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await enqueueTopicDiscovery(parsed.data.themeId, parsed.data.query?.trim() || undefined);
  return NextResponse.json({ queued: true });
}
