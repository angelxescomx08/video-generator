import { z } from "zod";

/**
 * Vincular un video ya subido a YouTube con su registro en la app.
 *
 * Existe porque publicar desde la app no es el unico camino real: un video se puede haber subido a
 * mano desde YouTube Studio (o desde el celular) y aun asi se quieren sus estadisticas para el
 * feedback loop. Sin este vinculo no hay fila en `published_videos`, y sin ella no hay de donde
 * colgar los snapshots de `video_stats` ni a que video de YouTube preguntarle.
 */

/** Los IDs de video de YouTube son 11 caracteres del alfabeto base64url. */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Saca el ID de video de lo que sea que el usuario pegue. Acepta las formas en que YouTube reparte
 * enlaces (watch, youtu.be, shorts, embed, live) y tambien el ID pelado, porque en la practica la
 * gente copia cualquiera de las dos cosas.
 *
 * Devuelve null si no encuentra un ID valido, en vez de adivinar: guardar un ID equivocado hace que
 * el poll traiga las estadisticas de OTRO video y contamine el aprendizaje con datos ajenos, que es
 * mucho peor que rechazar la entrada y pedirla de nuevo.
 */
export function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // Sin esquema, `new URL` falla; la gente pega "youtube.com/watch?v=..." bastante seguido.
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") return firstValidSegment(url.pathname);

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && YOUTUBE_ID_PATTERN.test(fromQuery)) return fromQuery;
    // /shorts/ID, /embed/ID, /live/ID, /v/ID
    return firstValidSegment(url.pathname);
  }

  return null;
}

function firstValidSegment(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  return segments.find((s) => YOUTUBE_ID_PATTERN.test(s)) ?? null;
}

export const linkYoutubeVideoRequestSchema = z.object({
  /** URL completa o ID pelado; se normaliza con extractYoutubeVideoId. */
  videoUrlOrId: z.string().min(1),
});
export type LinkYoutubeVideoRequest = z.infer<typeof linkYoutubeVideoRequestSchema>;
