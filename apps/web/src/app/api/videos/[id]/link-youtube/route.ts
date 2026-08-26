import { db, platformAccounts, publishedVideos, videos } from "@/lib/db";
import { enqueueStatsPoll } from "@/lib/queue";
import { extractYoutubeVideoId, linkYoutubeVideoRequestSchema } from "@video-generator/types";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Vincula un video que ya esta en YouTube con su registro en la app, y dispara el primer poll.
 *
 * Aqui NO se llama a la API de YouTube: la validacion contra la plataforma (que el video exista y sea
 * visible para la cuenta) la hace el worker en el poll que se encola al final, porque es ahi donde
 * vive el refresco del access token y porque `apps/web` no debe bloquear un request publico con
 * llamadas externas. Lo que si se valida aqui es la forma del ID, que es puro parsing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = linkYoutubeVideoRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "falta la URL o el ID del video" }, { status: 400 });
  }

  const externalVideoId = extractYoutubeVideoId(parsed.data.videoUrlOrId);
  if (!externalVideoId) {
    return NextResponse.json(
      { error: "no se reconocio un ID de video de YouTube en eso. Pega la URL completa del video o su ID de 11 caracteres." },
      { status: 400 },
    );
  }

  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });

  const [account] = await db
    .select()
    .from(platformAccounts)
    .where(and(eq(platformAccounts.platform, "youtube"), eq(platformAccounts.isActive, true)))
    .limit(1);

  if (!account) {
    return NextResponse.json(
      { error: "no hay una cuenta de YouTube conectada. Conectala en Configuracion > Cuentas." },
      { status: 409 },
    );
  }

  // Ya vinculado a este mismo video de YouTube: no se duplica, solo se vuelve a pollear. Idempotente
  // para que darle dos veces al boton no cree dos filas compitiendo por los mismos snapshots.
  const existing = await db.query.publishedVideos.findFirst({
    where: and(eq(publishedVideos.videoId, id), eq(publishedVideos.externalVideoId, externalVideoId)),
  });

  if (existing) {
    await enqueueStatsPoll(id);
    return NextResponse.json({ ...existing, alreadyLinked: true });
  }

  const [row] = await db
    .insert(publishedVideos)
    .values({
      videoId: id,
      platformAccountId: account.id,
      platform: "youtube",
      externalVideoId,
      externalUrl: `https://www.youtube.com/watch?v=${externalVideoId}`,
      // publishedAt queda null a proposito: la fecha real la rellena el worker desde la API, y es la
      // unica confiable para calcular la edad del video (la de hoy seria falsa en un video viejo).
      status: "published",
    })
    .returning();

  await enqueueStatsPoll(id);

  return NextResponse.json(row, { status: 201 });
}
