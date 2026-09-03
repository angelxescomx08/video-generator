import { z } from "zod";

/**
 * Hechos que el guion afirma, para no repetirlos en videos siguientes.
 *
 * Ambos campos llevan default en vez de ser obligatorios porque el handler de guion YA filtra lo
 * invalido antes de insertar (comprueba que `factType` este en FACT_TYPES y que `factValue` no este
 * vacio). Un hecho malformado tiene que degradar a "hecho descartado", no a "guion entero perdido".
 */
export const extractedFactSchema = z.object({
  factType: z.string().default(""),
  factValue: z.string().default(""),
});
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

/**
 * Una escena del guion = un plano.
 *
 * `estimatedDurationSeconds` y `visualKeywords` llevan default por la misma razon que los
 * parametros de efecto en edl.ts: el LLM acierta lo esencial (el texto narrado) mucho mas seguido
 * que el objeto completo, y la duracion estimada la PISA el worker de todas formas — mide la
 * duracion real del TTS y recalcula la linea de tiempo con `reconcileSceneTiming`. Exigir un campo
 * que se sobreescribe solo agranda la superficie donde el guion completo puede fallar.
 *
 * `index` es opcional aqui porque se reasigna por posicion al validar (ver
 * `scriptGenerationResultSchema`).
 */
export const scriptSceneSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  narrationText: z.string().min(1),
  estimatedDurationSeconds: z.number().positive().catch(5),
  visualKeywords: z.array(z.string()).catch([]),
  captionText: z.string().optional(),
});

/**
 * Lo que se le exige a un guion recien generado, sin importar que proveedor lo escribio.
 *
 * Existe porque los providers hacian `json as ScriptGenerationResult`: un cast no valida nada, asi
 * que una respuesta con otra forma se guardaba tal cual y reventaba mas adelante en el pipeline,
 * lejos del origen y con un error que no mencionaba al modelo. Con OpenAI/Gemini en modo de salida
 * estructurada la forma la garantiza la API, pero eso no cubre a Ollama (JSON mode a secas) ni al
 * reintento sin esquema, que son justo los caminos donde la forma puede venir mal.
 *
 * Que es obligatorio y que no:
 * - `title`, `script` y al menos una escena con `narrationText`: sin eso no hay video que hacer, y
 *   fallar aqui con un mensaje claro es mejor que guardar `title: undefined` y romper al publicar.
 * - `description`, `tags`, `extractedFacts`: secundarios. Con `.catch()` degradan a vacio en vez de
 *   tumbar el guion, incluso si el modelo devuelve el tipo equivocado (un string donde iba lista).
 *
 * Los `index` se reasignan por POSICION, no se validan: el pipeline usa `scene.index` como clave
 * real (`scene-${index}.wav` en generate-tts, y el cruce con `sceneAudio` en build-edl), asi que
 * indices duplicados o empezando en 1 hacian que dos escenas se pisaran el audio o que un cruce no
 * encontrara nada — en silencio. Reindexar garantiza 0..n-1 contiguos.
 */
export const scriptGenerationResultSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().catch(""),
    script: z.string().min(1),
    scenes: z.array(scriptSceneSchema).min(1),
    tags: z.array(z.string()).catch([]),
    extractedFacts: z.array(extractedFactSchema).catch([]),
  })
  .transform((result) => ({
    ...result,
    scenes: result.scenes.map((scene, position) => ({ ...scene, index: position })),
  }));

export type ScriptGenerationResult = z.infer<typeof scriptGenerationResultSchema>;
export type ScriptScene = ScriptGenerationResult["scenes"][number];
