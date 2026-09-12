import { db } from "@/lib/db";
import { enqueueTopicResearch, enqueueVideoGeneration } from "@/lib/queue";
import { topicProposals, videos } from "@video-generator/db";
import { DURATION_LIMITS, sanitizePromptText } from "@video-generator/types";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const actionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  /** Solo para `approve`: con que formato se crea el video. */
  format: z.enum(["long", "short"]).default("short"),
  /** Solo para `approve`: techo de duracion. Sin el, el default del formato. */
  targetDurationSeconds: z.number().int().positive().optional(),
  /** Idea editada por el usuario antes de aprobar. Sin ella se usa la que propuso la IA. */
  idea: z.string().min(1).optional(),
});

/** Estado minimo para que la tarjeta pueda esperar al worker sin recargar toda la pagina a ciegas. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = await db.query.topicProposals.findFirst({ where: eq(topicProposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
  return NextResponse.json({ researchStatus: proposal.researchStatus });
}

/**
 * Aprueba o rechaza una propuesta. Aprobar CREA el video y lo encola.
 *
 * La propuesta guarda `createdVideoId` en vez de borrarse: lo interesante de esta bandeja a los
 * seis meses no es que ideas quedan pendientes, sino cuales se convirtieron en video y como les
 * fue. Sin ese vinculo no hay forma de preguntarle a los datos si las ideas que propone el sistema
 * rinden mejor o peor que las que escribe el usuario.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const proposal = await db.query.topicProposals.findFirst({ where: eq(topicProposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });

  if (parsed.data.action === "reject") {
    await db
      .update(topicProposals)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(topicProposals.id, id));
    return NextResponse.json({ status: "rejected" });
  }

  if (proposal.createdVideoId) {
    return NextResponse.json({ error: "Esta propuesta ya genero un video" }, { status: 409 });
  }

  const { format } = parsed.data;
  // Se limpia igual que en /api/videos: es texto que acaba en el prompt del LLM, y aqui viene de
  // una pagina web que puede traer emojis y caracteres invisibles que solo gastan tokens.
  const idea = sanitizePromptText(parsed.data.idea ?? `${proposal.title}. ${proposal.idea}`).text;

  const [video] = await db
    .insert(videos)
    .values({
      themeId: proposal.themeId,
      format,
      topic: idea,
      captionsEnabled: true,
      targetDurationSeconds: parsed.data.targetDurationSeconds ?? DURATION_LIMITS[format].default,
      status: "queued",
      topicResearchSources: proposal.researchSources,
      topicResearchCost: proposal.researchCost,
    })
    .returning();

  await db
    .update(topicProposals)
    .set({ status: "approved", createdVideoId: video!.id, updatedAt: new Date() })
    .where(eq(topicProposals.id, id));

  await enqueueVideoGeneration(video!.id);
  return NextResponse.json({ status: "approved", videoId: video!.id });
}

/** Encola investigacion complementaria para que la tarjeta muestre fuentes antes de aprobarla. */
export async function PUT(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = await db.query.topicProposals.findFirst({ where: eq(topicProposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: "Solo se pueden investigar ideas pendientes" }, { status: 409 });
  }
  if (proposal.researchStatus === "queued" || proposal.researchStatus === "researching") {
    return NextResponse.json({ queued: true });
  }

  await db
    .update(topicProposals)
    .set({ researchStatus: "queued", updatedAt: new Date() })
    .where(eq(topicProposals.id, id));
  await enqueueTopicResearch(id);
  return NextResponse.json({ queued: true });
}
