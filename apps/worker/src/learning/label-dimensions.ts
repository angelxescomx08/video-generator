import { resolveProvider } from "@video-generator/ai-providers";
import { db, learningDimensions, videoDimensionLabels, videos } from "@video-generator/db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { logger } from "../util/logger";

/**
 * Contesta las preguntas descubiertas sobre los guiones que todavia no las tienen contestadas.
 *
 * Es la mitad que le faltaba al descubrimiento. El boton "Buscar patrones nuevos" etiqueta el canal
 * UNA vez, en el momento en que nace la pregunta, y despues nadie volvia a etiquetar nada: los
 * videos publicados mas tarde quedaban fuera de esa dimension para siempre. El sintoma medido en
 * este canal fue que las tres preguntas creadas el 1 de septiembre se quedaron con 19 videos
 * mientras el canal ya tenia 32 — y como una dimension que no crece su muestra nunca cambia de
 * veredicto, el sistema comparaba indefinidamente los mismos videos viejos.
 *
 * Se resuelve como un BACKFILL y no como "etiquetar al publicar" a proposito: al mirar los pares
 * (video, dimension) que faltan, un mismo mecanismo cubre los videos nuevos, las dimensiones nuevas
 * y cualquier etiqueta que se haya perdido por un fallo del clasificador. No hay estado que se
 * pueda desincronizar.
 */

/**
 * Recorte del guion que se le manda al clasificador.
 *
 * Con el arranque y el cierre alcanza para juzgar estructura, gancho y remate, que es de lo que
 * salen las hipotesis utiles. Se acota porque la propuesta manda 10 guiones en un solo prompt y un
 * video largo puede traer 1500 palabras cada uno.
 */
export const SCRIPT_CHAR_BUDGET = 1200;

export function trimScript(script: string): string {
  if (script.length <= SCRIPT_CHAR_BUDGET) return script;
  const head = Math.floor(SCRIPT_CHAR_BUDGET * 0.7);
  const tail = SCRIPT_CHAR_BUDGET - head;
  return `${script.slice(0, head)}\n[...]\n${script.slice(-tail)}`;
}

/** Clasificaciones en vuelo a la vez. El limite real es el rate limit del proveedor, no la CPU. */
const CLASSIFY_CONCURRENCY = 5;

export interface LabelingResult {
  /** Pares (video, dimension) que faltaban al empezar. */
  pending: number;
  /** Cuantos se pudieron contestar y guardar. */
  labeled: number;
}

/**
 * Etiqueta todos los pares (video publicado, dimension activa) que no tengan ya una respuesta.
 *
 * Una sola consulta encuentra el trabajo pendiente: cruza videos con dimensiones activas y descarta
 * por anti-join lo que ya esta etiquetado. Pedirlo por video seria una consulta por video, y esto
 * corre en el cron de estadisticas cada 6 horas.
 */
export async function labelMissingDimensions(): Promise<LabelingResult> {
  const pending = await db
    .select({
      videoId: videos.id,
      script: videos.script,
      dimensionId: learningDimensions.id,
      label: learningDimensions.label,
      question: learningDimensions.question,
      buckets: learningDimensions.buckets,
    })
    .from(videos)
    // Cruce videos x dimensiones activas: cada video necesita una respuesta por cada pregunta viva.
    .innerJoin(learningDimensions, eq(learningDimensions.status, "active"))
    .leftJoin(
      videoDimensionLabels,
      and(
        eq(videoDimensionLabels.videoId, videos.id),
        eq(videoDimensionLabels.dimensionId, learningDimensions.id),
      ),
    )
    .where(
      and(
        // `ready` cuenta ademas de `published` porque un video puede estar renderizado y todavia sin
        // subir; etiquetarlo antes no cuesta nada y evita una tanda grande el dia que se publique.
        inArray(videos.status, ["published", "ready"]),
        isNotNull(videos.script),
        isNull(videoDimensionLabels.id),
      ),
    );

  if (pending.length === 0) return { pending: 0, labeled: 0 };

  const provider = await resolveProvider();
  let labeled = 0;

  for (let i = 0; i < pending.length; i += CLASSIFY_CONCURRENCY) {
    const batch = pending.slice(i, i + CLASSIFY_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (row) => {
        try {
          const { result: bucket } = await provider.classifyDimension({
            script: trimScript(row.script!),
            question: row.question,
            buckets: row.buckets,
          });
          // Un bucket inventado no se guarda: dejaria un grupo de un solo video que ensucia la
          // comparacion sin aportar nada.
          if (!row.buckets.includes(bucket)) {
            logger.warn(`Respuesta fuera de las opciones para "${row.label}"`, { bucket, videoId: row.videoId });
            return null;
          }
          return { videoId: row.videoId, dimensionId: row.dimensionId, bucket };
        } catch (err) {
          logger.warn(`No se pudo clasificar el video ${row.videoId}`, { error: (err as Error).message });
          return null;
        }
      }),
    );

    const toInsert = results.filter((r): r is NonNullable<typeof r> => r !== null);
    if (toInsert.length > 0) {
      // `onConflictDoNothing` sobre el unique(video, dimension): si dos disparos se solapan (el cron
      // y una publicacion, por ejemplo), el segundo no duplica ni revienta.
      await db.insert(videoDimensionLabels).values(toInsert).onConflictDoNothing();
      labeled += toInsert.length;
    }
  }

  logger.info(`Etiquetado de dimensiones: ${labeled}/${pending.length} pares completados`);
  return { pending: pending.length, labeled };
}
