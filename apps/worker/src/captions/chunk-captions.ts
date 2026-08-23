import type { CaptionWordTiming } from "@video-generator/types";

export interface CaptionChunk {
  words: CaptionWordTiming[];
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ChunkOptions {
  /** Maximo de palabras por bloque en pantalla. */
  maxWords: number;
  /** Maximo de caracteres por bloque (evita que una linea se salga del safe zone). */
  maxChars: number;
  /** Maximo de segundos que un bloque permanece en pantalla. */
  maxDurationSeconds: number;
}

/** Shorts/Reels: bloques muy cortos, muy legibles, que cambian al ritmo del habla. */
export const SHORT_CHUNK_OPTIONS: ChunkOptions = { maxWords: 4, maxChars: 24, maxDurationSeconds: 2 };
/** Video largo (horizontal): la linea puede ser mas ancha porque hay mas espacio util. */
export const LONG_CHUNK_OPTIONS: ChunkOptions = { maxWords: 8, maxChars: 42, maxDurationSeconds: 3.5 };

/** Un final de frase es un buen punto de corte natural: evita partir una idea en dos bloques. */
function endsSentence(word: string): boolean {
  return /[.!?:;,]$/.test(word);
}

/**
 * Agrupa las palabras cronometradas en bloques cortos, cada uno con su propio rango de tiempo.
 *
 * Antes se emitia UN evento de subtitulo por escena (8-12s de narracion, ~25 palabras): un muro de
 * texto ilegible que ademas no acompañaba a la voz. Cortar en bloques de 2-4 palabras es lo que hace
 * que el subtitulo se sienta sincronizado con lo que se esta diciendo en ese instante.
 *
 * Funcion pura, sin I/O — testeable directamente.
 */
export function chunkWordTimings(words: CaptionWordTiming[], options: ChunkOptions): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: CaptionWordTiming[] = [];

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      words: current,
      text: current.map((w) => w.word).join(" "),
      startSeconds: current[0]!.startSeconds,
      endSeconds: current[current.length - 1]!.endSeconds,
    });
    current = [];
  };

  for (const word of words) {
    const candidate = [...current, word];
    const chars = candidate.map((w) => w.word).join(" ").length;
    const spanSeconds = word.endSeconds - candidate[0]!.startSeconds;

    // Cierra el bloque ANTES de agregar la palabra si con ella se pasaria de algun limite.
    const overflows =
      current.length > 0 &&
      (candidate.length > options.maxWords || chars > options.maxChars || spanSeconds > options.maxDurationSeconds);
    if (overflows) flush();

    current.push(word);

    // Corte natural en fin de frase, siempre que el bloque ya tenga cuerpo suficiente.
    if (endsSentence(word.word) && current.length >= 2) flush();
  }
  flush();

  return chunks;
}
