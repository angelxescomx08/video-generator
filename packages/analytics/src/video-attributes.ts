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
  /** El techo de duracion que se pidio al crear el video. `null` en videos anteriores al campo. */
  targetDurationSeconds: number | null;
  /**
   * Que fraccion del techo pedido ocupo el video (1.0 = lo lleno justo, 0.8 = se quedo a un 20%).
   *
   * Existe porque la duracion en segundos absolutos no distingue nada en un canal que pide siempre
   * el mismo techo: los 32 primeros videos duraron entre 61s y 99s y caian TODOS en el mismo grupo,
   * asi que la dimension de duracion no podia aprender nunca. El ratio si varia (0.80 a 1.10 en esos
   * mismos videos) porque mide una decision real del guion — cuanto del tiempo disponible se uso —
   * y no el numero que escribio el usuario.
   */
  durationFillRatio: number | null;
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
  /**
   * Familia de mood de la musica que suena, derivada de las tags que REALMENTE encontraron la pista.
   * `null` si el video no lleva musica o si es un EDL viejo que no registro con que tags la encontro.
   */
  musicMood: string | null;
  captionsEnabled: boolean;
  /**
   * Tipos de transicion usados en el EDL (cut, crossfade, fade_black).
   *
   * OJO: hoy esto NO se puede usar para aprender. El render encadena escenas con `concat` y todavia
   * no aplica `transitionOut` (ver edl-to-ffmpeg.ts), asi que este campo guarda una decision que
   * nunca llega a la pantalla. Cruzarlo contra la retencion mediria ruido, no una causa.
   */
  transitionTypes: string[];
  /** Tipos de efecto usados en el EDL (none, ken_burns, zoom_punch). Estos si se renderizan. */
  effectTypes: string[];
  /** Cuantos efectos DISTINTOS tiene el video. 1 = visualmente plano de principio a fin. */
  effectVariety: number;
  /** Efecto de la primera escena: el golpe visual (o su ausencia) con el que abre el video. */
  hookEffect: string | null;
  /** Si el gancho trae un numero/dato concreto, en digitos o en palabra. */
  hookHasNumber: boolean;
  /** Si el montaje lo decidio la IA o el fallback determinista (null en EDLs viejos, ver edl.ts). */
  edlGeneratedBy: "ai" | "fallback" | null;
}

/**
 * Familias de mood musical, en el orden en que se prueban.
 *
 * Las tags de los bancos son texto libre en ingles y practicamente infinitas ("epic", "uplifting",
 * "dark ambient"...): usarlas crudas como grupo daria un grupo de un video por tag y ninguna
 * comparacion posible. Se agrupan en cuatro familias porque la pregunta util no es "¿esta cancion
 * concreta funciono?" sino "¿a este canal le va mejor con musica tensa o con musica calmada?".
 *
 * El orden importa: una pista etiquetada "epic, dark" cae en tensa antes que en energetica, porque
 * lo que domina la sensacion es la tension. Lo que no encaja en ninguna queda fuera (null) en vez de
 * ir a un cajon "otras" que mezclaria cosas sin nada en comun.
 */
const MUSIC_MOOD_FAMILIES: ReadonlyArray<{ label: string; keywords: readonly string[] }> = [
  { label: "tensa/oscura", keywords: ["tense", "dark", "suspense", "dramatic", "mysterious", "horror", "sad"] },
  { label: "energetica", keywords: ["upbeat", "energetic", "action", "powerful", "rock", "electronic", "funk", "happy"] },
  { label: "inspiradora", keywords: ["inspirational", "hopeful", "uplifting", "emotional", "motivational", "epic"] },
  { label: "calmada", keywords: ["calm", "ambient", "relaxing", "soft", "peaceful", "meditation", "chill", "acoustic"] },
];

/** A que familia pertenece la musica, mirando las tags que efectivamente encontraron la pista. */
function classifyMusicMood(tags: string[] | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  const normalized = tags.map((t) => t.toLowerCase());
  for (const family of MUSIC_MOOD_FAMILIES) {
    if (normalized.some((tag) => family.keywords.some((kw) => tag.includes(kw)))) return family.label;
  }
  return null;
}

/** Numeros escritos con letra que aparecen en un gancho en español; los digitos van por regex. */
const SPANISH_NUMBER_WORDS =
  /\b(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|veinte|treinta|cuarenta|cincuenta|cien|ciento|mil|millon|millones)\b/i;

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
  const targetDurationSeconds = video.targetDurationSeconds ?? null;
  const sceneCount = edl?.scenes.length ?? scenes.length;
  const effectsUsed = unique((edl?.scenes ?? []).map((s) => s.effect.type));

  return {
    format: video.format,
    durationSeconds,
    targetDurationSeconds,
    durationFillRatio:
      durationSeconds !== null && targetDurationSeconds !== null && targetDurationSeconds > 0
        ? durationSeconds / targetDurationSeconds
        : null,
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
    musicMood: edl?.audio.backgroundMusicPath ? classifyMusicMood(edl.audio.backgroundMusicTags) : null,
    captionsEnabled: edl?.captions.enabled ?? video.captionsEnabled,
    transitionTypes: unique((edl?.scenes ?? []).map((s) => s.transitionOut.type)),
    effectTypes: effectsUsed,
    effectVariety: effectsUsed.length,
    hookEffect: edl?.scenes[0]?.effect.type ?? null,
    hookHasNumber: hookText !== null && (/\d/.test(hookText) || SPANISH_NUMBER_WORDS.test(hookText)),
    edlGeneratedBy: edl?.generatedBy ?? null,
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
    attrs.durationFillRatio ? `uso del tiempo=${Math.round(attrs.durationFillRatio * 100)}% del techo` : null,
    `escenas=${attrs.sceneCount}`,
    attrs.wordsPerSecond ? `ritmo=${attrs.wordsPerSecond.toFixed(2)} palabras/s` : null,
    `gancho=${attrs.hookIsQuestion ? "pregunta" : "afirmacion"}`,
    `efectos=${attrs.effectTypes.join("+") || "ninguno"}`,
    attrs.hasMusic ? "con musica" : "sin musica",
    attrs.captionsEnabled ? "con subtitulos" : "sin subtitulos",
  ].filter(Boolean);
  return parts.join(", ");
}
