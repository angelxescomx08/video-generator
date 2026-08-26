import type { Video } from "@video-generator/db";
import type { EditDecisionList, ScriptScene } from "@video-generator/types";

/**
 * Las caracteristicas de un video que pueden explicar su rendimiento. Son la mitad que le faltaba al
 * feedback loop: un snapshot de estadisticas por si solo dice "a este video le fue mal", lo cual no
 * se puede generalizar a otro tema. Emparejado con estos atributos si se puede — pasa a ser "a los
 * videos con gancho narrado de 4s y 9 escenas les va mal", que es una leccion aplicable a cualquier
 * tema del canal.
 *
 * Todos los campos salen de columnas que el pipeline ya guarda (`videos.scenes`, `videos.edl`), asi
 * que esto es derivacion pura: no necesita ninguna llamada externa ni columna nueva.
 */
export interface VideoAttributes {
  format: "long" | "short";
  durationSeconds: number | null;
  sceneCount: number;
  avgSceneSeconds: number | null;
  wordCount: number;
  /** Ritmo de narracion real. Muy por encima de ~2.8 suena atropellado; muy por debajo, lento. */
  wordsPerSecond: number | null;
  /** Primeras palabras que se escuchan: lo que decide la retencion a los 3 segundos. */
  hookText: string | null;
  hookWordCount: number;
  /** Un gancho que abre con pregunta genera curiosidad; uno que narra contexto la pierde. */
  hookIsQuestion: boolean;
  hasMusic: boolean;
  captionsEnabled: boolean;
  /** Tipos de transicion usados en el EDL (cut, crossfade, fade_black). */
  transitionTypes: string[];
  /** Tipos de efecto usados en el EDL (none, ken_burns, zoom_punch). */
  effectTypes: string[];
}

/** Cuantas palabras del inicio se consideran "el gancho" (~3 segundos a 150 ppm). */
const HOOK_WORD_COUNT = 12;

export function extractVideoAttributes(video: Video): VideoAttributes {
  const scenes = (video.scenes as ScriptScene[] | null) ?? [];
  const edl = video.edl as EditDecisionList | null;

  const narration = scenes.map((s) => s.narrationText ?? "").join(" ").trim();
  const words = narration.split(/\s+/).filter(Boolean);
  const hookWords = words.slice(0, HOOK_WORD_COUNT);
  const hookText = hookWords.length > 0 ? hookWords.join(" ") : null;

  const durationSeconds = video.durationSeconds ?? edl?.totalDurationSeconds ?? null;
  const sceneCount = edl?.scenes.length ?? scenes.length;

  return {
    format: video.format,
    durationSeconds,
    sceneCount,
    avgSceneSeconds: durationSeconds && sceneCount > 0 ? durationSeconds / sceneCount : null,
    wordCount: words.length,
    wordsPerSecond: durationSeconds && durationSeconds > 0 ? words.length / durationSeconds : null,
    hookText,
    hookWordCount: hookWords.length,
    // Se mira solo el gancho, no todo el guion: una pregunta en la escena 7 no explica la retencion
    // del segundo 3. El signo de apertura es opcional porque el LLM no siempre lo pone.
    hookIsQuestion: hookText !== null && /[?¿]/.test(hookText),
    hasMusic: Boolean(edl?.audio.backgroundMusicPath),
    captionsEnabled: edl?.captions.enabled ?? video.captionsEnabled,
    transitionTypes: unique((edl?.scenes ?? []).map((s) => s.transitionOut.type)),
    effectTypes: unique((edl?.scenes ?? []).map((s) => s.effect.type)),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Resumen de una linea para meter los atributos en un prompt sin gastar tokens de mas. */
export function describeVideoAttributes(attrs: VideoAttributes): string {
  const parts = [
    `formato=${attrs.format}`,
    attrs.durationSeconds ? `duracion=${Math.round(attrs.durationSeconds)}s` : null,
    `escenas=${attrs.sceneCount}`,
    attrs.wordsPerSecond ? `ritmo=${attrs.wordsPerSecond.toFixed(2)} palabras/s` : null,
    `gancho=${attrs.hookIsQuestion ? "pregunta" : "afirmacion"}`,
    attrs.hasMusic ? "con musica" : "sin musica",
    attrs.captionsEnabled ? "con subtitulos" : "sin subtitulos",
  ].filter(Boolean);
  return parts.join(", ");
}
