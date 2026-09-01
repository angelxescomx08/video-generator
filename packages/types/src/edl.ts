import { z } from "zod";
import { youtubeAudioSuggestionSchema } from "./youtube-audio-library";

/**
 * Los parametros secundarios de cada efecto llevan `.default()` a proposito: el LLM acierta el `type`
 * (que es la decision editorial) mucho mas seguido de lo que acierta el objeto completo, y sin default
 * un `{ "type": "ken_burns" }` sin `direction` tumbaba TODO el EDL a la validacion y mandaba el video
 * al fallback determinista. Un default aqui degrada a "efecto con parametros genericos"; sin el, se
 * degradaba a "el video entero pierde las decisiones de la IA".
 */
export const sceneEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("ken_burns"),
    direction: z.enum(["in", "out"]).default("in"),
    panX: z.enum(["left", "right", "center"]).optional(),
    panY: z.enum(["up", "down", "center"]).optional(),
  }),
  z.object({
    type: z.literal("zoom_punch"),
    intensity: z.enum(["low", "medium", "high"]).default("medium"),
  }),
]);
export type SceneEffect = z.infer<typeof sceneEffectSchema>;

export const sceneTransitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cut") }),
  z.object({ type: z.literal("crossfade"), durationSeconds: z.number().positive().default(0.5) }),
  z.object({ type: z.literal("fade_black"), durationSeconds: z.number().positive().default(0.5) }),
]);
export type SceneTransition = z.infer<typeof sceneTransitionSchema>;

export const captionWordTimingSchema = z.object({
  word: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
});
export type CaptionWordTiming = z.infer<typeof captionWordTimingSchema>;

export const captionStyleSchema = z.object({
  fontFamily: z.string(),
  fontSizePx: z.number().positive(),
  color: z.string(),
  highlightColor: z.string().optional(),
  position: z.enum(["bottom", "center", "top"]),
  backgroundBox: z.boolean().optional(),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

/**
 * Estilo canonico de subtitulos. Es la fuente unica de verdad: el LLM tambien devuelve un
 * `captions.style` en su EDL, pero no conoce las safe zones de YouTube ni los requisitos de
 * contraste, asi que el worker lo sobreescribe con esto.
 *
 * Decisiones (convenciones de subtitulado quemado para Shorts/Reels):
 * - Blanco sobre contorno negro grueso: la combinacion de maximo contraste, legible sobre cualquier
 *   footage. El contorno se dibuja en srt-builder.ts, no aqui.
 * - Amarillo dorado para la palabra que se esta pronunciando (resalte karaoke); es el color de
 *   resalte mas usado y el que mejor se distingue del blanco.
 * - `position: "bottom"` con margenes que respetan la UI de YouTube (ver captions/safe-area.ts).
 * - Sin recuadro de fondo: el contorno grueso ya garantiza legibilidad y tapa menos imagen.
 */
export function defaultCaptionStyle(format: "long" | "short"): CaptionStyle {
  return {
    fontFamily: "Arial",
    // ~4% del alto del lienzo: grande de verdad, como en los Shorts que si se leen en un movil.
    fontSizePx: format === "short" ? 80 : 48,
    color: "#FFFFFF",
    highlightColor: "#FFD700",
    position: "bottom",
    backgroundBox: false,
  };
}

/**
 * `startSeconds` y `clip` llevan default porque el worker los SOBREESCRIBE siempre
 * (`reconcileSceneTiming` recalcula la linea de tiempo sobre la duracion medida del TTS y
 * `withSceneClips` asigna el clip descargado). Pedirselos al LLM solo daba una forma mas grande que
 * fallar; con default, el modelo puede devolver unicamente lo que si es decision suya —
 * `effect` y `transitionOut` — sin arriesgar la validacion del EDL completo.
 */
export const edlSceneSchema = z.object({
  index: z.number().int().nonnegative(),
  startSeconds: z.number().nonnegative().default(0),
  durationSeconds: z.number().positive(),
  clip: z
    .object({
      sourcePath: z.string(),
      mediaType: z.enum(["video", "image"]),
    })
    .default({ sourcePath: "", mediaType: "video" }),
  effect: sceneEffectSchema,
  transitionOut: sceneTransitionSchema,
  captionText: z.string().optional(),
  captionWordTimings: z.array(captionWordTimingSchema).optional(),
});
export type EDLScene = z.infer<typeof edlSceneSchema>;

export const editDecisionListSchema = z.object({
  version: z.literal(1),
  format: z.enum(["long", "short"]),
  totalDurationSeconds: z.number().positive(),
  /**
   * Quien decidio el montaje: la IA o el fallback determinista. Lo escribe el worker, no el LLM.
   *
   * Existe porque su ausencia costo caro: `generateEDL` fallaba en todos los videos y el unico rastro
   * era un `logger.warn`, asi que el canal entero se genero con el fallback (mismo efecto en todas
   * las escenas, sin tags de musica) sin que nada lo delatara. Con esta marca, un video sin
   * decisiones de IA se puede ver en la UI y separar en las analiticas.
   *
   * Opcional porque los EDL guardados antes de que existiera no la tienen: ahi es "desconocido".
   */
  generatedBy: z.enum(["ai", "fallback"]).optional(),
  audio: z.object({
    // Lo rellena el worker con el wav ya concatenado; el LLM nunca conoce esta ruta.
    voiceoverPath: z.string().default(""),
    backgroundMusicPath: z.string().optional(),
    backgroundMusicVolumeDb: z.number().optional(),
    /** Id en `music_tracks` si la musica es una cancion subida por el usuario (no de un banco). */
    backgroundMusicTrackId: z.string().uuid().optional(),
    /** Titulo legible de la pista, para mostrarlo en la lista de versiones sin otra consulta. */
    backgroundMusicLabel: z.string().optional(),
    /**
     * Las tags que REALMENTE encontraron la pista, no las que se pidieron.
     *
     * `musicSuggestionTags` es lo que la IA queria; la busqueda prueba varias combinaciones y puede
     * terminar cayendo a las tags del tema o a las genericas. Sin registrar cual funciono, cruzar el
     * tipo de musica contra el rendimiento estaria etiquetando cada video con una musica que
     * posiblemente no es la que suena.
     */
    backgroundMusicTags: z.array(z.string()).optional(),
    /** Tags de mood/genero en ingles sugeridos por la IA para buscar musica libre de copyright
     * que encaje con el tono del video (ver EDL_JSON_INSTRUCTIONS / prompts de cada AIProvider). */
    musicSuggestionTags: z.array(z.string()).optional(),
    /**
     * Sugerencia acotada a los filtros REALES de la Biblioteca de audio de YouTube Studio, para
     * que el usuario pueda buscar musica ahi al editar el video. A diferencia de
     * `musicSuggestionTags` (texto libre para APIs tipo Jamendo), aqui solo caben valores que
     * existen como filtro en YouTube — ver youtube-audio-library.ts.
     */
    youtubeAudioLibrary: youtubeAudioSuggestionSchema.optional(),
  }),
  // El worker pisa `enabled` (preferencia del usuario) y `style` (safe zones de YouTube) justo
  // despues de validar, asi que no hay razon para exigirselos al LLM y arriesgar el EDL entero.
  captions: z
    .object({
      enabled: z.boolean().default(false),
      style: captionStyleSchema,
    })
    .default({ enabled: false, style: defaultCaptionStyle("short") }),
  scenes: z.array(edlSceneSchema),
});
export type EditDecisionList = z.infer<typeof editDecisionListSchema>;

/**
 * Efecto de una escena cuando lo decide el fallback (no la IA).
 *
 * No es "un efecto cualquiera": reparte pattern interrupts a proposito. La guia de retencion para
 * formato corto es que el plano cambie de energia cada 10-15s — un video entero con el mismo
 * ken_burns lento se lee como presentacion de diapositivas y la caida de audiencia no se aplana.
 * Por eso el gancho abre con un zoom fuerte, hay un segundo golpe alrededor del 30% (donde cae el
 * segundo escalon de retencion), y el resto alterna direccion y paneo para que no haya dos escenas
 * seguidas con el mismo movimiento.
 */
function fallbackSceneEffect(index: number, sceneCount: number): SceneEffect {
  if (index === 0) return { type: "zoom_punch", intensity: "high" };

  const reengagementBeat = Math.round(sceneCount * 0.3);
  if (sceneCount >= 4 && index === reengagementBeat) return { type: "zoom_punch", intensity: "medium" };

  const pans = ["center", "left", "right"] as const;
  return {
    type: "ken_burns",
    direction: index % 2 === 0 ? "in" : "out",
    panX: pans[index % pans.length]!,
    panY: "center",
  };
}

/** Default deterministic EDL used when LLM-generated EDL fails validation twice in a row. */
export function buildFallbackEdl(params: {
  format: "long" | "short";
  voiceoverPath: string;
  scenes: Array<{ sourcePath: string; mediaType: "video" | "image"; durationSeconds: number; captionText?: string }>;
}): EditDecisionList {
  let cursor = 0;
  const scenes: EDLScene[] = params.scenes.map((scene, index) => {
    const edlScene: EDLScene = {
      index,
      startSeconds: cursor,
      durationSeconds: scene.durationSeconds,
      clip: { sourcePath: scene.sourcePath, mediaType: scene.mediaType },
      effect: fallbackSceneEffect(index, params.scenes.length),
      transitionOut:
        index === params.scenes.length - 1 ? { type: "cut" } : { type: "crossfade", durationSeconds: 0.5 },
      captionText: scene.captionText,
    };
    cursor += scene.durationSeconds;
    return edlScene;
  });

  return {
    version: 1,
    format: params.format,
    totalDurationSeconds: cursor,
    audio: { voiceoverPath: params.voiceoverPath },
    captions: {
      enabled: false,
      style: defaultCaptionStyle(params.format),
    },
    scenes,
  };
}
