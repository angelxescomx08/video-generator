import { YOUTUBE_AUDIO_GENRES, YOUTUBE_AUDIO_MOODS } from "@video-generator/types";
import type { EditDecisionList, PerformanceLearning, ProviderCost } from "@video-generator/types";
import type { StockClipRef } from "@video-generator/types";

export interface ScriptScene {
  index: number;
  narrationText: string;
  estimatedDurationSeconds: number;
  visualKeywords: string[];
  captionText?: string;
}

export interface MemoryContextItem {
  content: string;
  contentType: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface FeedbackSummary {
  rating: number | null;
  comment: string | null;
  createdAt: Date;
  /** 'theme' si es feedback de este mismo tema, 'channel' si viene de otro tema del canal. */
  scope?: "theme" | "channel";
}

/**
 * Una correlacion medida entre como se hizo un video y como le fue, calculada sobre TODO el canal
 * (no por tema). La calcula `@video-generator/analytics` a partir de las estadisticas reales de
 * YouTube, no la inventa el modelo.
 *
 * Lleva `sampleSize` y `deltaPoints` a proposito: el prompt le dice al modelo cuantos videos
 * respaldan cada patron, para que no trate una diferencia de 3 videos como una ley.
 *
 * La forma vive en `@video-generator/types` porque tambien la dibuja la UI de analiticas; aqui solo
 * se re-exporta para no romper a quien ya la importaba desde este paquete.
 */
export type { PerformanceLearning } from "@video-generator/types";

export interface ScriptGenerationRequest {
  themeSlug: string;
  systemPrompt: string;
  userPromptTemplate: string;
  topic?: string;
  format: "long" | "short";
  targetDurationSeconds: number;
  memoryContext: MemoryContextItem[];
  avoidFacts: string[];
  recentFeedback: FeedbackSummary[];
  /** Patrones de rendimiento medidos en TODO el canal (ver PerformanceLearning). Opcional: llega
   * vacio mientras no haya suficientes videos publicados con estadisticas. */
  performanceLearnings?: PerformanceLearning[];
  /** Instruccion puntual del feedback que disparo esta regeneracion (p.ej. "hazlo mas largo") — se debe priorizar sobre el resto del contexto. */
  regenerationInstruction?: string;
  /** Guia de tono/estilo + refuerzo de duracion (numero de palabras/escenas). La arma el builder; todos los providers la deben incluir en el prompt. */
  styleGuide?: string;
}

export interface ExtractedFact {
  factType: string;
  factValue: string;
}

export interface ScriptGenerationResult {
  title: string;
  description: string;
  script: string;
  scenes: ScriptScene[];
  tags: string[];
  extractedFacts: ExtractedFact[];
}

export interface EDLGenerationRequest {
  scenes: ScriptScene[];
  availableClips: StockClipRef[];
  format: "long" | "short";
  themeSlug: string;
}

export interface EmbeddingRequest {
  text: string;
}

export class NotImplementedError extends Error {
  constructor(providerName: string, method: string) {
    super(`${providerName} does not implement ${method} yet`);
    this.name = "NotImplementedError";
  }
}

/** Los bancos de stock (Pixabay/Pexels) indexan tags mayormente en ingles; sin esto el LLM
 * devuelve visualKeywords en el idioma del guion y las busquedas de stock fallan seguido. */
export const VISUAL_KEYWORDS_INSTRUCTION =
  "Importante: aunque el guion este en español, el campo visualKeywords de cada escena debe estar" +
  " en ingles, con 2-4 palabras simples y genericas (sustantivos concretos, no frases), ideales" +
  " para buscar en bancos de video como Pixabay o Pexels.";

/**
 * Dos sugerencias de musica con proposito distinto:
 *
 * - `musicSuggestionTags`: texto libre en ingles, para buscar por API en bancos como Jamendo.
 * - `youtubeAudioLibrary`: acotado a los filtros REALES de la Biblioteca de audio de YouTube
 *   Studio, para que el usuario pueda buscar a mano al editar. Se enumeran los valores permitidos
 *   porque un valor inventado no existe como filtro y la sugerencia seria inservible; el worker
 *   valida contra la misma lista y descarta lo que no encaje.
 */
export const MUSIC_SUGGESTION_INSTRUCTION =
  "Ademas, agrega audio.musicSuggestionTags: 2-4 palabras EN INGLES describiendo el mood/genero de" +
  " musica de fondo libre de copyright que mejor encaje con el tono de este video (ej. " +
  '["epic", "cinematic", "tense"] o ["upbeat", "corporate", "motivational"]), para buscarla en' +
  " bancos como Jamendo.\n\n" +
  "Agrega TAMBIEN audio.youtubeAudioLibrary con la forma" +
  ' {"genres": [...], "moods": [...]}, eligiendo 1-2 generos y 1-2 estados de animo que mejor' +
  " encajen con el tono del video. USA EXACTAMENTE estos valores, copiados tal cual (son los" +
  " filtros de la Biblioteca de audio de YouTube; cualquier otro valor se descarta):\n" +
  `genres: ${YOUTUBE_AUDIO_GENRES.map((g) => `"${g}"`).join(", ")}\n` +
  `moods: ${YOUTUBE_AUDIO_MOODS.map((m) => `"${m}"`).join(", ")}`;

/**
 * Como elegir el efecto de cada escena. Es la unica decision del EDL que llega intacta al video
 * renderizado: el worker recalcula tiempos, reasigna clips y pisa el estilo de subtitulos, y las
 * transiciones todavia no se aplican (el render encadena con `concat`, ver edl-to-ffmpeg.ts). Si el
 * modelo pone el mismo efecto en todas las escenas, el video queda visualmente plano de punta a
 * punta, que es la forma mas rapida de perder retencion en formato corto.
 *
 * Las reglas salen de la guia de retencion para Shorts: el gancho necesita un golpe visual en los
 * primeros segundos, y despues hace falta un cambio de energia cada 10-15s para reiniciar la
 * atencion antes de que el espectador se despegue.
 */
export const SCENE_EFFECT_INSTRUCTION =
  "Elige el effect de cada escena con intencion editorial, NO el mismo para todas:\n" +
  '- Escena del gancho (la primera): {"type": "zoom_punch", "intensity": "high"} — necesita un golpe' +
  " visual que frene el scroll.\n" +
  '- Momento de giro/revelacion o clímax: {"type": "zoom_punch", "intensity": "medium" | "high"}.\n' +
  '- Escenas narrativas: {"type": "ken_burns", "direction": "in" | "out", "panX": ..., "panY": ...},' +
  " alternando direccion para que no haya dos escenas seguidas con el mismo movimiento.\n" +
  '- {"type": "none"} solo si el clip ya tiene movimiento propio fuerte.\n' +
  "Regla dura: usa AL MENOS 2 tipos de efecto distintos en el video. Un video entero con el mismo" +
  " efecto se siente estatico y pierde audiencia.";

export interface AICallResult<T> {
  result: T;
  cost: ProviderCost;
}

export interface AIProvider {
  readonly name: string;
  /**
   * Caracteres que embed() manda como maximo antes de recortar. Lo expone el provider porque el
   * limite depende del MODELO configurado, no solo del proveedor (gemini-embedding-001 admite 2048
   * tokens y gemini-embedding-2, 8192). Sirve para avisar del recorte sin duplicar esa tabla fuera.
   */
  readonly embeddingCharBudget?: number;
  generateScript(req: ScriptGenerationRequest): Promise<AICallResult<ScriptGenerationResult>>;
  generateEDL(req: EDLGenerationRequest): Promise<AICallResult<EditDecisionList>>;
  embed(req: EmbeddingRequest): Promise<AICallResult<number[]>>;
  healthCheck(): Promise<boolean>;
}
