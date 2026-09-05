import { YOUTUBE_AUDIO_GENRES, YOUTUBE_AUDIO_MOODS } from "@video-generator/types";
import type {
  EditDecisionList,
  ExtractedFact,
  PerformanceLearning,
  ProviderCost,
  ScriptGenerationResult,
  ScriptScene,
} from "@video-generator/types";
import type { StockClipRef } from "@video-generator/types";

/**
 * La forma de una escena y del guion completo la define el zod de `@video-generator/types`
 * (script.ts), no una interfaz suelta aqui: es lo que valida `parseScriptResult` en los cuatro
 * providers, asi que el tipo y la validacion no pueden separarse.
 */
export type { ExtractedFact, ScriptGenerationResult, ScriptScene };

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
  /**
   * TECHO de duracion en segundos, no un objetivo: el guion es correcto en cualquier punto entre el
   * piso que fija el `styleGuide` y este numero. El rango concreto (y la conversion a palabras) va
   * en el bloque DURACION del `styleGuide`; aqui viaja solo el limite duro.
   */
  maxDurationSeconds: number;
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

/** Un guion que rindio bien o mal, como se le muestra a la IA para que busque que los distingue. */
export interface ScriptOutcomeSample {
  script: string;
  /** La metrica con la que se juzgo, ya en porcentaje. */
  outcomeValue: number;
}

export interface DimensionProposalRequest {
  best: ScriptOutcomeSample[];
  worst: ScriptOutcomeSample[];
  /** Nombre de la metrica que separa a unos de otros ("porcentaje del video visto"). */
  outcomeLabel: string;
  /** Lo que el motor YA mide, para que no proponga una pregunta que ya existe. */
  alreadyMeasured: string[];
  maxProposals: number;
}

export interface ProposedDimension {
  label: string;
  question: string;
  buckets: string[];
  rationale: string;
}

export interface DimensionClassificationRequest {
  script: string;
  question: string;
  buckets: string[];
}

/** Un resultado de busqueda web, como se le muestra al modelo para que proponga temas. */
export interface TopicResearchSource {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface TopicProposalRequest {
  /** Nombre y descripcion del tema del canal, para que las propuestas encajen en el. */
  themeName: string;
  themeDescription?: string;
  /** Lo que se encontro en la web. Puede venir vacio si la busqueda fallo. */
  sources: TopicResearchSource[];
  /** Titulos de videos que el canal YA hizo, para no proponer lo mismo otra vez. */
  alreadyCovered: string[];
  maxProposals: number;
}

export interface ProposedTopic {
  /** Titulo de trabajo de la idea, no el titulo final del video. */
  title: string;
  /** La idea desarrollada: es lo que acaba en `videos.topic` si se aprueba. */
  idea: string;
  /** Por que engancharia a alguien. Se guarda para poder juzgar la propuesta, no solo el resultado. */
  angle: string;
  /** URLs de `sources` en las que se apoya. Sirve para verificar antes de aprobar. */
  sourceUrls: string[];
}

/** Instrucciones compartidas por todos los providers para el descubrimiento de dimensiones. */
export const DIMENSION_PROPOSAL_INSTRUCTION =
  "Cada propuesta debe cumplir TODO esto, o no sirve:\n" +
  "- La pregunta se tiene que poder contestar leyendo UNICAMENTE el texto del guion, sin ver el video" +
  " ni conocer sus estadisticas.\n" +
  "- Tiene que partir los guiones en grupos de tamano parecido. Una pregunta que contesta igual para" +
  " el 95% de los guiones no sirve para comparar nada.\n" +
  "- `buckets` debe traer entre 2 y 3 respuestas posibles, excluyentes entre si y exhaustivas" +
  " (cualquier guion debe caer en una).\n" +
  "- No repitas nada de lo que ya se mide.\n" +
  "- Debe ser algo que se pueda DECIDIR al escribir el siguiente guion, no un accidente del tema.\n" +
  "- `rationale`: que viste en los guiones buenos que no esta en los malos. Se honesto si la senal es" +
  " debil; con esta cantidad de guiones puede no haber ningun patron real, y decirlo es una respuesta" +
  " valida.\n" +
  "- `label`: 2-4 palabras en minusculas y con espacios, como se leeria en un tablero" +
  ' ("estructura del guion", "tipo de conflicto"). Nada de snake_case ni nombres de variable.';

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
  /**
   * Propone preguntas nuevas que podrian explicar por que unos guiones retienen mas que otros.
   *
   * Solo genera la HIPOTESIS. No decide si es cierta: eso lo resuelve despues la agregacion sobre
   * datos reales, que es la unica parte del sistema con derecho a concluir algo.
   */
  proposeDimensions(req: DimensionProposalRequest): Promise<AICallResult<ProposedDimension[]>>;
  /** Contesta una pregunta propuesta sobre UN guion, eligiendo uno de los buckets. */
  classifyDimension(req: DimensionClassificationRequest): Promise<AICallResult<string>>;
  /**
   * Propone temas de video a partir de lo que se encontro buscando en la web.
   *
   * La busqueda NO la hace el modelo: llega ya hecha en `req.sources`, desde
   * `@video-generator/search-providers`. Por eso esto funciona igual en un provider sin soporte de
   * herramientas (Ollama) que en uno con grounding nativo (Gemini) — el modelo solo redacta y
   * selecciona sobre texto que ya tiene delante.
   */
  proposeTopics(req: TopicProposalRequest): Promise<AICallResult<ProposedTopic[]>>;
  embed(req: EmbeddingRequest): Promise<AICallResult<number[]>>;
  healthCheck(): Promise<boolean>;
  /**
   * Lista los modelos que el proveedor tiene disponibles ahora mismo (no un catalogo estatico), para
   * poblar el selector de modelo en /settings/providers. Es una consulta de metadata: ningun
   * proveedor la cobra como si fuera inferencia.
   */
  listModels(): Promise<string[]>;
}

/** Prompt de propuesta, compartido: la unica diferencia entre providers es como se pide el JSON. */
export function buildDimensionProposalPrompt(req: DimensionProposalRequest): string {
  const sample = (s: ScriptOutcomeSample, i: number) =>
    `--- Guion ${i + 1} (${s.outcomeValue.toFixed(1)}% de ${req.outcomeLabel}) ---\n${s.script}`;

  return `Estos son los guiones que MEJOR rindieron de un canal:

${req.best.map(sample).join("\n\n")}

Y estos los que PEOR rindieron:

${req.worst.map(sample).join("\n\n")}

El sistema ya mide estas caracteristicas y no aprendio nada nuevo de ellas:
${req.alreadyMeasured.map((m) => `- ${m}`).join("\n")}

Propon hasta ${req.maxProposals} PREGUNTAS nuevas sobre el contenido o la construccion del guion que podrian explicar la diferencia y que NO esten ya en esa lista.

${DIMENSION_PROPOSAL_INSTRUCTION}

Responde JSON: { "proposals": [{ "label": string, "question": string, "buckets": string[], "rationale": string }] }`;
}

/**
 * Prompt de propuesta de temas, compartido.
 *
 * Las reglas apuntan a un unico fallo: que el modelo devuelva el mismo tema de siempre con otro
 * nombre. Un canal que lleva 30 videos ya conto lo evidente, asi que se le pasan los titulos ya
 * hechos y se le pide explicitamente el angulo que NO se ha usado. El filtro real contra repetidos
 * viene despues y es semantico (embeddings contra los guiones anteriores); esto solo evita gastar
 * una propuesta en algo obvio.
 */
export function buildTopicProposalPrompt(req: TopicProposalRequest): string {
  const sources = req.sources.length
    ? req.sources.map((s, i) => `[${i + 1}] ${s.title} (${s.source})\n${s.url}\n${s.snippet}`).join("\n\n")
    : "(la busqueda no devolvio resultados; propon desde tu propio conocimiento y deja sourceUrls vacio)";

  const covered = req.alreadyCovered.length
    ? req.alreadyCovered.map((t) => `- ${t}`).join("\n")
    : "(el canal todavia no tiene videos)";

  const about = req.themeDescription ? `\nDe que va el canal: ${req.themeDescription}` : "";

  return `Eres el investigador de contenidos de un canal de YouTube sobre "${req.themeName}".${about}

ESTO ES LO QUE SE ENCONTRO BUSCANDO EN LA WEB:

${sources}

VIDEOS QUE EL CANAL YA HIZO (no propongas nada que sea esto con otras palabras):
${covered}

Propon hasta ${req.maxProposals} ideas de video. Cada una debe cumplir TODO esto:
- Apoyarse en lo que dicen las fuentes de arriba, no en algo que te suene. Cita en sourceUrls las URLs concretas que la sostienen.
- Ser un tema CONCRETO, no una categoria. "El dia que Pedro nego a Jesus tres veces" sirve; "historias del Nuevo Testamento" no.
- Traer un angulo que la gente no conozca ya: un detalle sorprendente, una contradiccion, un dato historico o arqueologico, algo que rete lo que se suele creer. Si la idea es la version de siempre de una historia conocida, no la propongas.
- Ser distinta de los videos ya hechos y distinta de las otras propuestas de esta misma respuesta.
- "idea": 3-5 frases con la historia y el material concreto (nombres, cifras, lugares, versiculos si aplica) que usaria el guionista. Es lo que se le va a pasar tal cual para escribir el guion, asi que tiene que bastarse solo.
- "angle": UNA frase diciendo por que alguien se quedaria a verlo.

Si las fuentes no dan para ${req.maxProposals} ideas buenas, devuelve menos. Una propuesta floja cuesta un video entero.

Responde JSON: { "proposals": [{ "title": string, "idea": string, "angle": string, "sourceUrls": string[] }] }`;
}

/** Prompt de clasificacion, compartido por los cuatro providers. */
export function buildDimensionClassificationPrompt(req: DimensionClassificationRequest): string {
  return `Lee este guion y contesta la pregunta eligiendo EXACTAMENTE una de las opciones dadas.

PREGUNTA: ${req.question}
OPCIONES (copia una literal, tal cual): ${req.buckets.map((b) => `"${b}"`).join(" | ")}

GUION:
${req.script}

Responde JSON: { "bucket": "<una de las opciones, copiada literal>" }`;
}
