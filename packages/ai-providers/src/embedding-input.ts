/**
 * Recorte del texto que se manda a embeber.
 *
 * Los modelos de embeddings tienen un contexto FIJO y pequeno (2048 tokens en `nomic-embed-text` y en
 * `text-embedding-004` de Gemini), y al pasarse no truncan: devuelven un error que revienta el stage
 * completo. Como `videos.target_duration_seconds` admite hasta 1800s (~27.000 caracteres de guion),
 * cualquier video largo fallaba siempre al guardar su memoria — y el error ("the input length exceeds
 * the context length") no dice ni que texto fue ni de donde salio.
 *
 * Se recorta el INICIO del texto porque para lo que sirve esta memoria (reconocer "ya escribi algo
 * asi") el planteamiento y el gancho son la parte que identifica al guion; el desenlace aporta mucho
 * menos a esa comparacion.
 *
 * Lo correcto a futuro seria partir el texto en varios chunks y guardar un embedding por chunk, para
 * no perder la segunda mitad de un guion largo. Se recorta por ahora porque es la diferencia entre
 * que funcione y que falle, y el recorte es explicito y observable en vez de silencioso.
 */

/**
 * Caracteres seguros por modelo. Son deliberadamente conservadores: el limite real se mide en tokens y
 * la densidad varia con el idioma (el español gasta mas tokens por caracter que el ingles), asi que se
 * deja margen en vez de calcular al filo. Medido contra nomic-embed-text, que empieza a fallar
 * alrededor de los 5.500-6.000 caracteres de texto en español.
 */
export const EMBEDDING_CHAR_BUDGETS = {
  /** nomic-embed-text: 2048 tokens. Medido: empieza a fallar sobre los 5.500-6.000 caracteres. */
  ollama: 4000,
  /** Depende del modelo (2048 vs 8192 tokens); se usa geminiCharBudget() en vez de este valor. */
  gemini: 4000,
  /** text-embedding-3-*: 8191 tokens. */
  openai: 20000,
} as const;

/**
 * Presupuesto para Gemini segun el modelo, porque el limite NO es el mismo entre versiones:
 * `gemini-embedding-001` admite 2048 tokens de entrada y `gemini-embedding-2` admite 8192. Un solo
 * numero para "gemini" recortaria de mas con el modelo grande o reventaria con el chico, asi que se
 * decide por nombre de modelo y se cae al valor conservador ante un modelo desconocido.
 */
export function geminiCharBudget(model: string): number {
  // ~3 caracteres por token en español, con margen: 8192 tokens -> 12.000, 2048 tokens -> 4.000.
  if (model.startsWith("gemini-embedding-2")) return 12000;
  return EMBEDDING_CHAR_BUDGETS.gemini;
}

export type EmbeddingBudgetKey = keyof typeof EMBEDDING_CHAR_BUDGETS;

/** True si el texto se va a recortar con este presupuesto — para poder avisarlo antes de mandarlo. */
export function willTruncate(text: string, maxChars: number): boolean {
  return text.length > maxChars;
}

/**
 * Recorta a `maxChars` cortando en el ultimo espacio, para no partir una palabra por la mitad y meter
 * un token basura justo al final del texto que se va a embeber.
 */
export function truncateForEmbedding(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const hardCut = text.slice(0, maxChars);
  const lastSpace = hardCut.lastIndexOf(" ");
  // Si no hay espacios en el ultimo 20% (p.ej. una URL larguisima), se corta en seco: es mejor eso
  // que devolver un texto mucho mas corto de lo pedido.
  return lastSpace > maxChars * 0.8 ? hardCut.slice(0, lastSpace) : hardCut;
}
