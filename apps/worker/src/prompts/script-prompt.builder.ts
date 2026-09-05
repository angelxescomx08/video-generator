import { db, feedback } from "@video-generator/db";
import type { ScriptGenerationRequest } from "@video-generator/ai-providers";
import type { Theme, Video } from "@video-generator/db";
import {
  computeWordBudget,
  resolveDurationBand,
  WORDS_PER_MINUTE,
  type DurationBand,
  type ProviderCost,
} from "@video-generator/types";
import { eq } from "drizzle-orm";
import { getAvoidFacts, getRecentFeedback, retrieveMemoryContext } from "../memory/retrieve";
import { getLearningsReport } from "@video-generator/analytics";
import {
  buildExplorationBlock,
  chooseExploration,
  type ExplorationChoice,
  type PipelineExperimentPlan,
} from "./exploration";
import { logger } from "../util/logger";

const REPEATABLE_FACT_TYPES = ["bible_verse_used", "quote_used", "title_used"] as const;

export async function buildScriptGenerationRequest(
  theme: Theme,
  video: Video,
): Promise<{ request: ScriptGenerationRequest; exploration: ExplorationChoice | null; cost: ProviderCost }> {
  const queryText = `${theme.name} ${video.topic ?? ""}`.trim();

  const [memory, avoidFacts, recentFeedback, learningsReport, regenerationInstruction] = await Promise.all([
    retrieveMemoryContext(theme.id, queryText),
    getAvoidFacts(theme.id, [...REPEATABLE_FACT_TYPES]),
    getRecentFeedback(theme.id),
    // Global a proposito, sin filtrar por tema: como se escribe un gancho que retiene no es una
    // particularidad del tema, y limitarlo por tema tira casi toda la muestra en un canal chico.
    // Se pide el reporte completo (lecciones + diagnostico) porque las dos mitades del bucle salen
    // de ahi: lo aprendido se explota, y lo que no se pudo aprender se explora.
    getLearningsReport(),
    resolveRegenerationInstruction(video.pendingFeedbackId),
  ]);

  // Lo que el usuario escribio es el TECHO; el piso lo deriva el formato (ver `resolveDurationBand`).
  const band = resolveDurationBand(video.format, video.targetDurationSeconds);

  // Una regeneracion nace de feedback concreto del usuario sobre ESTE video: meterle encima un
  // experimento le cambiaria el gancho por razones que no tienen nada que ver con lo que pidio.
  const exploration = regenerationInstruction
    ? null
    : chooseExploration(learningsReport.coverage, learningsReport.learnings, learningsReport.sampleCount);
  if (exploration) {
    logger.info(`Video ${video.id}: experimento de ${exploration.kind} en "${exploration.dimension}"`, {
      grupoDeReferencia: exploration.referenceBucket,
    });
  }

  return {
    request: {
      themeSlug: theme.slug,
      systemPrompt: theme.systemPrompt,
      userPromptTemplate: theme.scriptPromptTemplate,
      topic: video.topic ?? undefined,
      format: video.format,
      maxDurationSeconds: band.maxSeconds,
      memoryContext: memory.items,
      avoidFacts,
      recentFeedback,
      performanceLearnings: learningsReport.learnings,
      regenerationInstruction,
      // El experimento va al final del styleGuide, despues del tono: es una excepcion puntual a esa
      // guia y tiene que leerse despues de ella para que gane.
      styleGuide: [
        buildStyleGuide(band, video.format, exploration?.plan),
        exploration ? buildExplorationBlock(exploration) : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    // Lo devuelve para que el handler lo guarde en la fila del video: los experimentos de pipeline se
    // deciden aqui pero se aplican al montar el EDL, dos stages despues.
    exploration,
    cost: memory.cost,
  };
}

/**
 * Guia de tono/estilo + refuerzo de duracion. El refuerzo de duracion es clave: sin un rango de
 * palabras/escenas explicito, el LLM tiende a devolver guiones demasiado cortos y superficiales
 * (p.ej. 28s cuando se pidieron 90) o, si se le pide mucho, a pasarse de largo (p.ej. 211s cuando se
 * pidieron 140). Convertimos la banda de segundos en un rango de palabras y de escenas concreto.
 *
 * La asimetria es deliberada y es todo el punto de la banda: quedarse corto dentro del piso es una
 * duracion valida, pasarse del techo no lo es. Por eso las dos mitades del rango no se redactan
 * igual — el minimo se pide, el maximo se prohibe cruzar.
 */
/**
 * Segundos de narracion por escena — y como una escena es un plano con su propio clip, esto decide
 * CADA CUANTO CAMBIA LA IMAGEN, que es la palanca de retencion mas barata que tiene el pipeline.
 *
 * Los dos numeros salen de referencias distintas a proposito:
 * - `short`: en formato vertical el plano deberia cambiar cada 3-5s, y hace falta un cambio de
 *   energia cada 10-15s para reiniciar la atencion. Con los 10s de antes, un Short de 90s cambiaba
 *   de imagen 9 veces en total (~8.6s por plano medidos sobre el canal): mas cerca de una
 *   presentacion de diapositivas que de un Short.
 * - `long`: la referencia es la contraria, 3-5 cortes por minuto. Aplicarle el ritmo de Shorts a un
 *   video de 10 minutos daria 120 escenas — 120 busquedas y descargas de stock — sin ganar nada.
 *
 * Es el numero que hay que mover si se quiere probar otro ritmo: sube los cortes y baja el texto por
 * escena a la vez, porque el presupuesto de palabras total no cambia.
 */
const SECONDS_PER_SCENE = { short: 5, long: 10 } as const;

function buildStyleGuide(
  band: DurationBand,
  format: "long" | "short",
  /** Desviaciones del experimento asignado a este video, si lleva uno. */
  plan?: PipelineExperimentPlan,
): string {
  const aimed = aimWithinBand(band, plan?.durationBias);
  const { minWords, maxWords } = computeWordBudget(aimed);
  const secondsPerScene = plan?.secondsPerScene ?? SECONDS_PER_SCENE[format];
  // El numero de escenas sale del centro de la banda y no del techo: pedir las escenas del maximo y
  // las palabras del rango dejaria las ultimas escenas casi vacias si el guion sale por el lado corto.
  const sceneCount = Math.max(3, Math.round((aimed.minSeconds + aimed.maxSeconds) / 2 / secondsPerScene));

  const durationBlock = `DURACION Y EXTENSION (obligatorio, se valida automaticamente):
- El guion debe durar ENTRE ${aimed.minSeconds} Y ${aimed.maxSeconds} segundos al narrarse en voz alta. Cualquier duracion dentro de ese rango es correcta: no tienes que clavar un numero exacto.
- ${aimed.maxSeconds} segundos es un TECHO, no una meta. Pasarte es el unico error grave de duracion que existe aqui, porque el sistema recorta el guion automaticamente y la historia se queda cortada a la mitad.
- A ~${WORDS_PER_MINUTE} palabras/minuto, ese rango equivale a ENTRE ${minWords} Y ${maxWords} palabras de narracion en total (suma de todas las escenas). Cuenta tus palabras mientras escribes y no cruces ${maxWords}.
- Divide la narracion en unas ${sceneCount} escenas de ~${secondsPerScene}s cada una${
    format === "short"
      ? " — cada escena es un plano distinto, y si el plano no cambia el espectador se va"
      : ""
  }${
    secondsPerScene <= 6
      ? ", es decir UNA sola idea o frase por escena"
      : ", con espacio para desarrollar la idea dentro de cada una"
  }, cada una con su narrationText.
- Con ese presupuesto de palabras, cuenta una historia completa pero compacta: ve directo al punto en cada escena, sin relleno ni descripciones largas. Prioriza que quepan planteamiento, desarrollo y cierre dentro del limite antes que desarrollar cada parte a fondo. Es preferible cerrar bien la historia en ${aimed.minSeconds} segundos que estirarla para llegar a ${aimed.maxSeconds}.`;

  return `${SCRIPT_TONE_GUIDE}

${durationBlock}

${buildSeoGuide(format)}`;
}

/**
 * Estrecha la banda a su mitad corta o a su mitad larga cuando el video lleva un experimento de
 * duracion; sin experimento se pide la banda completa.
 *
 * Se estrecha en vez de mover el techo porque el techo lo puso el usuario: un experimento puede
 * decidir apuntar mas corto, nunca autorizarse a durar mas de lo que se pidio.
 */
function aimWithinBand(band: DurationBand, bias: "corto" | "largo" | undefined): DurationBand {
  if (!bias) return band;
  const mid = Math.round((band.minSeconds + band.maxSeconds) / 2);
  return bias === "corto"
    ? { minSeconds: band.minSeconds, maxSeconds: mid }
    : { minSeconds: mid, maxSeconds: band.maxSeconds };
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
- Cuenta una historia COMPLETA (planteamiento, desarrollo con obstaculos, climax y resolucion) dentro del rango de duracion que se te da mas abajo. No estires 30 segundos de contenido para llenar tiempo ni rellenes: si la historia cierra bien antes del maximo, cierrala ahi. Revela el contexto sobre la marcha, con accion, no en un bloque de exposicion inicial.
- Elimina relleno y muletillas ("ademas", "cabe destacar", "en conclusion", "es importante notar"). Cada frase debe avanzar la historia.
- Cierra pagando la promesa del gancho y termina con un solo CTA claro y natural, ligado al valor que acabas de entregar.`;

async function resolveRegenerationInstruction(pendingFeedbackId: string | null): Promise<string | undefined> {
  if (!pendingFeedbackId) return undefined;
  const row = await db.query.feedback.findFirst({ where: eq(feedback.id, pendingFeedbackId) });
  return row?.comment ?? undefined;
}
