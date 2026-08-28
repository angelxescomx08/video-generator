/**
 * Limpieza del texto que el usuario escribe antes de que llegue al LLM.
 *
 * Motivo: los emojis, los caracteres invisibles y la puntuacion tipografica cuestan tokens de
 * entrada sin aportar nada al guion - un solo emoji suele gastar 2-4 tokens, y un texto pegado de
 * WhatsApp/Word trae docenas. Limpiar aqui abarata cada generacion sin tocar el contenido real.
 *
 * Es una funcion PURA y sin dependencias a proposito: corre igual en el cliente (para que el
 * usuario vea el cambio en el textarea antes de enviar) y en la API route (para que el texto que
 * se guarda en `videos.topic` ya venga limpio aunque alguien llame al endpoint directo).
 *
 * Lo que NO hace: tocar el contenido semantico. No borra URLs, ni cifras, ni palabras. Si el
 * resultado cambia el significado de algo, es un bug.
 *
 * Los rangos van escritos con escapes \uXXXX a proposito: este archivo se mantiene ASCII puro para
 * que los caracteres invisibles que justamente estamos borrando no vivan literales en el fuente,
 * donde ningun editor los muestra y cualquier copy/paste los pierde.
 */

/** Aproximacion chars->tokens. Los tokenizers reales rondan 3.5-4 chars/token en espanol. */
const CHARS_PER_TOKEN = 4;

export interface SanitizedPrompt {
  /** El texto ya limpio, listo para mandar al modelo. */
  text: string;
  originalChars: number;
  cleanedChars: number;
  removedChars: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  estimatedTokensSaved: number;
  /** Cuantos emojis/pictogramas se quitaron (para poder decirselo al usuario). */
  emojisRemoved: number;
  /** Caracteres invisibles (zero-width, BOM, marcas bidi, selectores de variacion). */
  invisiblesRemoved: number;
  /** false cuando el texto ya estaba limpio y no hubo nada que quitar. */
  changed: boolean;
}

/** Caracteres de control, salvo \t y \n que si son estructura del texto. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** Soft hyphen, zero-width, marcas bidi, separadores de parrafo, selectores de variacion y BOM. */
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF]/gu;
/** Emojis, simbolos pictograficos, banderas, modificadores de tono de piel y keycaps. */
const EMOJI_CHARS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u20E3]/gu;

/** Puntuacion tipografica -> ASCII. El equivalente ASCII casi siempre tokeniza mas barato. */
const TYPOGRAPHIC_REPLACEMENTS: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u201C-\u201F\u2033\u00AB\u00BB]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, "-"],
  [/\u2026/g, "..."],
  [/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " "],
  [/[\u2022\u2023\u2043\u25AA\u25CF\u25E6\u2219\u00B7]/g, "-"],
];

export function sanitizePromptText(raw: string): SanitizedPrompt {
  const originalChars = raw.length;

  // NFKC colapsa fullwidth, ligaduras y variantes compatibles a su forma canonica mas corta.
  let text = raw.normalize("NFKC");

  const invisiblesRemoved =
    (text.match(INVISIBLE_CHARS)?.length ?? 0) + (text.match(CONTROL_CHARS)?.length ?? 0);
  text = text.replace(CONTROL_CHARS, "").replace(INVISIBLE_CHARS, "");

  const emojisRemoved = text.match(EMOJI_CHARS)?.length ?? 0;
  text = text.replace(EMOJI_CHARS, "");

  for (const [pattern, replacement] of TYPOGRAPHIC_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  // Decoracion de markdown: los marcadores son ruido para el modelo, el texto de adentro no.
  text = text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // [ \t] y no \s: con \s el cuantificador se come los saltos de linea previos y fusiona parrafos.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "");

  // Puntuacion repetida por enfasis ("QUE!!!!", "en serio???").
  text = text
    .replace(/([!?])\1+/g, "$1")
    .replace(/\.{4,}/g, "...")
    .replace(/-{3,}/g, "--");

  // Espacios: uno por linea, sin sangria ni cola, y maximo un renglon en blanco entre parrafos.
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const cleanedChars = text.length;
  const estimatedTokensBefore = Math.ceil(originalChars / CHARS_PER_TOKEN);
  const estimatedTokensAfter = Math.ceil(cleanedChars / CHARS_PER_TOKEN);

  return {
    text,
    originalChars,
    cleanedChars,
    removedChars: originalChars - cleanedChars,
    estimatedTokensBefore,
    estimatedTokensAfter,
    estimatedTokensSaved: Math.max(0, estimatedTokensBefore - estimatedTokensAfter),
    emojisRemoved,
    invisiblesRemoved,
    changed: text !== raw,
  };
}
