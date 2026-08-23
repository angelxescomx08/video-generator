import { z } from "zod";

/**
 * Generos y estados de animo EXACTOS que ofrece la Biblioteca de audio de YouTube Studio
 * (verificados 2026-08-23). Son listas cerradas a proposito: la idea es que la sugerencia se pueda
 * pegar tal cual en los filtros de YouTube, asi que una etiqueta inventada por el LLM ("epic",
 * "trailer") no sirve de nada — no existe como filtro.
 *
 * Los valores se guardan con la etiqueta en ingles porque es la que aparece en los filtros de
 * YouTube; las traducciones de abajo son solo para mostrar en la UI.
 *
 * Fuentes:
 * - https://support.google.com/youtube/answer/3376882
 * - https://influencermarketinghub.com/youtube-audio-library/
 */
export const YOUTUBE_AUDIO_GENRES = [
  "Alternative & Punk",
  "Ambient",
  "Children's",
  "Cinematic",
  "Classical",
  "Country & Folk",
  "Dance & Electronic",
  "Hip-Hop & Rap",
  "Holiday",
  "Jazz & Blues",
  "Pop",
  "R&B & Soul",
  "Reggae",
  "Rock",
] as const;
export type YoutubeAudioGenre = (typeof YOUTUBE_AUDIO_GENRES)[number];

export const YOUTUBE_AUDIO_MOODS = [
  "Angry",
  "Bright",
  "Calm",
  "Dark",
  "Dramatic",
  "Funky",
  "Happy",
  "Inspirational",
  "Romantic",
  "Sad",
] as const;
export type YoutubeAudioMood = (typeof YOUTUBE_AUDIO_MOODS)[number];

export const YOUTUBE_AUDIO_GENRE_LABELS_ES: Record<YoutubeAudioGenre, string> = {
  "Alternative & Punk": "Alternativo y punk",
  Ambient: "Ambiental",
  "Children's": "Infantil",
  Cinematic: "Cinematografico",
  Classical: "Clasica",
  "Country & Folk": "Country y folk",
  "Dance & Electronic": "Dance y electronica",
  "Hip-Hop & Rap": "Hip-hop y rap",
  Holiday: "Navidena / festiva",
  "Jazz & Blues": "Jazz y blues",
  Pop: "Pop",
  "R&B & Soul": "R&B y soul",
  Reggae: "Reggae",
  Rock: "Rock",
};

export const YOUTUBE_AUDIO_MOOD_LABELS_ES: Record<YoutubeAudioMood, string> = {
  Angry: "Furioso",
  Bright: "Luminoso",
  Calm: "Tranquilo",
  Dark: "Oscuro",
  Dramatic: "Dramatico",
  Funky: "Funky",
  Happy: "Alegre",
  Inspirational: "Inspirador",
  Romantic: "Romantico",
  Sad: "Triste",
};

export const youtubeAudioSuggestionSchema = z.object({
  genres: z.array(z.enum(YOUTUBE_AUDIO_GENRES)).max(3),
  moods: z.array(z.enum(YOUTUBE_AUDIO_MOODS)).max(3),
});
export type YoutubeAudioSuggestion = z.infer<typeof youtubeAudioSuggestionSchema>;

/** Palabras sueltas (las que suele devolver el LLM en musicSuggestionTags) -> genero de YouTube. */
const TAG_TO_GENRE: Array<[RegExp, YoutubeAudioGenre]> = [
  [/\b(cinematic|epic|trailer|orchestral|score|soundtrack)\b/i, "Cinematic"],
  [/\b(ambient|atmospheric|drone|meditation|meditative)\b/i, "Ambient"],
  [/\b(classical|piano|strings|orchestra|violin)\b/i, "Classical"],
  [/\b(electronic|edm|synth|synthwave|techno|house|dance)\b/i, "Dance & Electronic"],
  [/\b(hip.?hop|rap|trap|beat|boom.?bap)\b/i, "Hip-Hop & Rap"],
  [/\b(jazz|blues|swing|saxophone)\b/i, "Jazz & Blues"],
  [/\b(folk|country|acoustic|banjo|americana)\b/i, "Country & Folk"],
  [/\b(rock|guitar|metal|grunge)\b/i, "Rock"],
  [/\b(punk|alternative|indie)\b/i, "Alternative & Punk"],
  [/\b(soul|r&b|rnb|motown|gospel)\b/i, "R&B & Soul"],
  [/\b(reggae|ska|dub)\b/i, "Reggae"],
  [/\b(pop|catchy|radio)\b/i, "Pop"],
  [/\b(christmas|holiday|navidad)\b/i, "Holiday"],
  [/\b(kids|children|playful|cartoon)\b/i, "Children's"],
];

/** Palabras sueltas -> estado de animo de YouTube. */
const TAG_TO_MOOD: Array<[RegExp, YoutubeAudioMood]> = [
  [/\b(inspirational|inspiring|motivational|uplifting|hopeful|triumphant)\b/i, "Inspirational"],
  [/\b(dramatic|tense|suspense|suspenseful|intense|epic)\b/i, "Dramatic"],
  [/\b(dark|ominous|sinister|eerie|mysterious|somber)\b/i, "Dark"],
  [/\b(calm|peaceful|relax|relaxing|serene|gentle|soft|ambient)\b/i, "Calm"],
  [/\b(sad|melancholy|melancholic|emotional|sorrow|mournful)\b/i, "Sad"],
  [/\b(happy|cheerful|joyful|fun|playful)\b/i, "Happy"],
  [/\b(bright|upbeat|energetic|positive|optimistic)\b/i, "Bright"],
  [/\b(romantic|love|tender|intimate)\b/i, "Romantic"],
  [/\b(funky|groovy|groove)\b/i, "Funky"],
  [/\b(angry|aggressive|furious|rage)\b/i, "Angry"],
];

function matchAll<T>(tags: string[], table: Array<[RegExp, T]>, limit: number): T[] {
  const haystack = tags.join(" ");
  const found: T[] = [];
  for (const [pattern, value] of table) {
    if (pattern.test(haystack) && !found.includes(value)) found.push(value);
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * Deriva la sugerencia de YouTube a partir de las etiquetas libres del LLM
 * (`audio.musicSuggestionTags`, del estilo ["epic", "cinematic", "tense"]).
 *
 * Sirve de red de seguridad: si el LLM no devuelve la sugerencia acotada, o si se uso el EDL de
 * fallback deterministico, igual hay algo util que mostrar en pantalla. Funcion pura, testeable.
 */
export function deriveYoutubeAudioSuggestion(tags: string[]): YoutubeAudioSuggestion {
  const genres = matchAll(tags, TAG_TO_GENRE, 2);
  const moods = matchAll(tags, TAG_TO_MOOD, 2);
  return {
    // Sin ninguna coincidencia, "Cinematic" + "Inspirational" es el par mas neutro y usable para
    // video narrado (que es lo que genera este pipeline).
    genres: genres.length > 0 ? genres : ["Cinematic"],
    moods: moods.length > 0 ? moods : ["Inspirational"],
  };
}
