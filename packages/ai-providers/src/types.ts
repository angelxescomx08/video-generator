import { YOUTUBE_AUDIO_GENRES, YOUTUBE_AUDIO_MOODS } from "@video-generator/types";
import type { EditDecisionList, ProviderCost } from "@video-generator/types";
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
}

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

export interface AICallResult<T> {
  result: T;
  cost: ProviderCost;
}

export interface AIProvider {
  readonly name: string;
  generateScript(req: ScriptGenerationRequest): Promise<AICallResult<ScriptGenerationResult>>;
  generateEDL(req: EDLGenerationRequest): Promise<AICallResult<EditDecisionList>>;
  embed(req: EmbeddingRequest): Promise<AICallResult<number[]>>;
  healthCheck(): Promise<boolean>;
}
