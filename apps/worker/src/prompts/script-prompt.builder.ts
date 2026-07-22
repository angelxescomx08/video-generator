import { db, feedback } from "@video-generator/db";
import type { ScriptGenerationRequest } from "@video-generator/ai-providers";
import type { Theme, Video } from "@video-generator/db";
import { eq } from "drizzle-orm";
import { getAvoidFacts, getRecentFeedback, retrieveMemoryContext } from "../memory/retrieve";

const REPEATABLE_FACT_TYPES = ["bible_verse_used", "quote_used", "title_used"] as const;

/** Palabras por minuto de narracion en espanol (ritmo natural, ni lento ni atropellado). */
const WORDS_PER_MINUTE = 150;

export async function buildScriptGenerationRequest(theme: Theme, video: Video): Promise<ScriptGenerationRequest> {
  const queryText = `${theme.name} ${video.topic ?? ""}`.trim();

  const [memoryContext, avoidFacts, recentFeedback, regenerationInstruction] = await Promise.all([
    retrieveMemoryContext(theme.id, queryText),
    getAvoidFacts(theme.id, [...REPEATABLE_FACT_TYPES]),
    getRecentFeedback(theme.id),
    resolveRegenerationInstruction(video.pendingFeedbackId),
  ]);

  const targetDurationSeconds = video.targetDurationSeconds ?? (video.format === "short" ? 90 : 300);

  return {
    themeSlug: theme.slug,
    systemPrompt: theme.systemPrompt,
    userPromptTemplate: theme.scriptPromptTemplate,
    topic: video.topic ?? undefined,
    format: video.format,
    targetDurationSeconds,
    memoryContext,
    avoidFacts,
    recentFeedback,
    regenerationInstruction,
    styleGuide: buildStyleGuide(targetDurationSeconds),
  };
}

/**
 * Guia de tono/estilo + refuerzo de duracion. El refuerzo de duracion es clave: sin un objetivo de
 * palabras/escenas explicito, el LLM tiende a devolver guiones demasiado cortos y superficiales
 * (p.ej. 28s cuando se pidieron 90). Convertimos los segundos objetivo en un rango de palabras y de
 * escenas concreto para que llene realmente la duracion.
 */
function buildStyleGuide(targetDurationSeconds: number): string {
  const targetWords = Math.round((targetDurationSeconds / 60) * WORDS_PER_MINUTE);
  const minWords = Math.round(targetWords * 0.9);
  const maxWords = Math.round(targetWords * 1.15);
  const sceneCount = Math.max(3, Math.round(targetDurationSeconds / 10));

  const durationBlock = `DURACION Y EXTENSION (obligatorio):
- El guion debe durar aproximadamente ${targetDurationSeconds} segundos al narrarse en voz alta.
- A ~${WORDS_PER_MINUTE} palabras/minuto, eso equivale a entre ${minWords} y ${maxWords} palabras de narracion. NO te quedes corto.
- Divide la narracion en unas ${sceneCount} escenas (aprox. 8-12s cada una), cada una con su narrationText.
- Usa TODO el tiempo disponible para desarrollar la historia: contexto, desarrollo, tension y cierre. Nada de resumenes superficiales.`;

  return `${SCRIPT_TONE_GUIDE}\n\n${durationBlock}`;
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
