import { db, feedback } from "@video-generator/db";
import type { ScriptGenerationRequest } from "@video-generator/ai-providers";
import type { Theme, Video } from "@video-generator/db";
import type { ProviderCost } from "@video-generator/types";
import { eq } from "drizzle-orm";
import { getAvoidFacts, getRecentFeedback, retrieveMemoryContext } from "../memory/retrieve";

const REPEATABLE_FACT_TYPES = ["bible_verse_used", "quote_used", "title_used"] as const;

/** Palabras por minuto de narracion en espanol (ritmo natural, ni lento ni atropellado). */
export const WORDS_PER_MINUTE = 150;

export async function buildScriptGenerationRequest(
  theme: Theme,
  video: Video,
): Promise<{ request: ScriptGenerationRequest; cost: ProviderCost }> {
  const queryText = `${theme.name} ${video.topic ?? ""}`.trim();

  const [memory, avoidFacts, recentFeedback, regenerationInstruction] = await Promise.all([
    retrieveMemoryContext(theme.id, queryText),
    getAvoidFacts(theme.id, [...REPEATABLE_FACT_TYPES]),
    getRecentFeedback(theme.id),
    resolveRegenerationInstruction(video.pendingFeedbackId),
  ]);

  const targetDurationSeconds = video.targetDurationSeconds ?? (video.format === "short" ? 90 : 300);

  return {
    request: {
      themeSlug: theme.slug,
      systemPrompt: theme.systemPrompt,
      userPromptTemplate: theme.scriptPromptTemplate,
      topic: video.topic ?? undefined,
      format: video.format,
      targetDurationSeconds,
      memoryContext: memory.items,
      avoidFacts,
      recentFeedback,
      regenerationInstruction,
      styleGuide: buildStyleGuide(targetDurationSeconds, video.format),
    },
    cost: memory.cost,
  };
}

/** Rango de palabras aceptable para un guion, dado el target en segundos. Comparten esta formula
 * el prompt (buildStyleGuide) y el recorte deterministico post-generacion (clampScenesToWordBudget)
 * para que ambos midan "se paso" con el mismo criterio. */
export function computeWordBudget(targetDurationSeconds: number): { targetWords: number; minWords: number; maxWords: number } {
  const targetWords = Math.round((targetDurationSeconds / 60) * WORDS_PER_MINUTE);
  return {
    targetWords,
    minWords: Math.round(targetWords * 0.9),
    maxWords: Math.round(targetWords * 1.1),
  };
}

/**
 * Guia de tono/estilo + refuerzo de duracion. El refuerzo de duracion es clave: sin un objetivo de
 * palabras/escenas explicito, el LLM tiende a devolver guiones demasiado cortos y superficiales
 * (p.ej. 28s cuando se pidieron 90) o, si se le pide mucho, a pasarse de largo (p.ej. 211s cuando se
 * pidieron 140). Convertimos los segundos objetivo en un rango de palabras y de escenas concreto, y
 * remarcamos que pasarse del maximo es tan incorrecto como quedarse corto (hay un recorte automatico
 * despues si no se respeta, que corta la historia de forma abrupta).
 */
function buildStyleGuide(targetDurationSeconds: number, format: "long" | "short"): string {
  const { minWords, maxWords } = computeWordBudget(targetDurationSeconds);
  const sceneCount = Math.max(3, Math.round(targetDurationSeconds / 10));

  const durationBlock = `DURACION Y EXTENSION (obligatorio, se valida automaticamente):
- El guion debe durar aproximadamente ${targetDurationSeconds} segundos al narrarse en voz alta.
- A ~${WORDS_PER_MINUTE} palabras/minuto, eso equivale a ENTRE ${minWords} Y ${maxWords} palabras de narracion en total (suma de todas las escenas). Este es un rango estricto: pasarte de ${maxWords} palabras es tan incorrecto como quedarte corto de ${minWords} — si te pasas, el sistema recorta el guion automaticamente y corta la historia a la mitad, así que cuenta tus palabras mientras escribes.
- Divide la narracion en unas ${sceneCount} escenas (aprox. 8-12s cada una), cada una con su narrationText.
- Con ese presupuesto de palabras, cuenta una historia completa pero compacta: ve directo al punto en cada escena, sin relleno ni descripciones largas. Prioriza que quepan planteamiento, desarrollo y cierre dentro del limite antes que desarrollar cada parte a fondo.`;

  return `${SCRIPT_TONE_GUIDE}\n\n${durationBlock}\n\n${buildSeoGuide(format)}`;
}

/**
 * Reglas de SEO para YouTube (title/description/tags) — investigadas contra las guias vigentes de
 * YouTube Shorts en 2026. YouTube ya NO requiere el hashtag #Shorts para clasificar el video como
 * Short (lo detecta solo por relacion de aspecto vertical + duracion), pero incluir 2-4 hashtags
 * relevantes en la descripcion sigue ayudando a la busqueda/discovery.
 */
function buildSeoGuide(format: "long" | "short"): string {
  const shortSpecific = `- Es un YouTube Short: el titulo debe ser un gancho corto y directo (no necesitas escribir "#Shorts" en ningun lado, YouTube lo detecta solo por el formato vertical). Al final de la descripcion agrega 2-4 hashtags en español, cortos y directamente relacionados al tema (ej. #curiosidades #datos) — nunca mas de 4, y nunca hashtags genericos sin relacion.`;
  const longSpecific = `- Es un video largo: la descripcion puede ser un poco mas extensa que en un Short (hasta ~200 palabras) y puede incluir 1-2 hashtags relevantes al final si encajan naturalmente, sin forzarlos.`;

  return `SEO (title, description, tags — obligatorio, esto determina si YouTube posiciona bien el video):
- title: pon la palabra o frase clave principal (lo que alguien buscaria o lo que mas engancha del video) dentro de las primeras 3-5 palabras. Maximo ~60 caracteres para que no se corte en busqueda/sugeridos. Nada de mayusculas sostenidas ni clickbait que el video no cumpla — la promesa del titulo debe pagarse en el guion.
- description: las primeras ~125 caracteres son las unicas visibles antes de "mas" — deben resumir el video y contener la palabra clave principal de forma natural (no una lista de keywords pegadas). Despues de eso, 2-3 frases mas de contexto/keywords relacionados de forma natural, sin repetir la misma palabra clave sin necesidad. Cierra con una llamada a la accion breve (ej. suscribirse, comentar que opinan).
${format === "short" ? shortSpecific : longSpecific}
- tags: entre 5 y 8 tags en español, mezclando 2-3 amplios (el tema general, ej. "historia", "curiosidades") con el resto especificos al video puntual (nombres, lugares, el hecho concreto que se cuenta). Sin relleno, sin tags repetidos ni irrelevantes — cada tag es algo que alguien realmente buscaria.`;
}

/** Guia de TONO y estilo de redaccion (basada en buenas practicas de guionismo para YouTube). */
const SCRIPT_TONE_GUIDE = `TONO Y ESTILO (obligatorio):
- Escribe como si lo hablaras en voz alta a UNA sola persona, en segunda persona ("tu"), con tono conversacional, cercano y natural. Usa contracciones, voz activa y frases cortas: ninguna oracion debe pasar de ~15 palabras; si pasa, dividela. Prohibido sonar formal, corporativo o de "modo presentacion".
- Empieza con un gancho en los primeros 3 segundos: salta directo a la accion, a la afirmacion mas fuerte o a una pregunta que genere curiosidad. Nunca abras con saludos ("Hola a todos, bienvenidos...") ni con "Hoy vamos a hablar de...". El gancho debe prometer valor o retar una creencia comun y conectar con la emocion por la que alguien haria clic.
- Estructura la historia para retener: abre un loop (una pregunta o cliffhanger sin resolver) al inicio y cierralo al final. Usa logica de "pero / por lo tanto" (causa-efecto), no "y luego... y luego". Sube las apuestas por etapas y mete un giro o cambio de ritmo cada 45-90 segundos. Genera tension antes de cada payoff.
- Aprovecha TODA la duracion objetivo para contar una historia completa (planteamiento, desarrollo con obstaculos, climax y resolucion); no estires 30 segundos de contenido ni rellenes. Revela el contexto sobre la marcha, con accion, no en un bloque de exposicion inicial.
- Elimina relleno y muletillas ("ademas", "cabe destacar", "en conclusion", "es importante notar"). Cada frase debe avanzar la historia.
- Cierra pagando la promesa del gancho y termina con un solo CTA claro y natural, ligado al valor que acabas de entregar.`;

async function resolveRegenerationInstruction(pendingFeedbackId: string | null): Promise<string | undefined> {
  if (!pendingFeedbackId) return undefined;
  const row = await db.query.feedback.findFirst({ where: eq(feedback.id, pendingFeedbackId) });
  return row?.comment ?? undefined;
}
