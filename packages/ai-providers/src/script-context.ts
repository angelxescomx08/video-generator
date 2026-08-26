import type { ScriptGenerationRequest } from "./types";

/**
 * Arma el prompt de usuario para generar un guion, identico para los cuatro providers.
 *
 * Existe porque cada provider tenia su propia copia de este texto y las copias se desincronizaron:
 * Anthropic y Ollama inyectaban la memoria, los hechos a evitar y el feedback, mientras que Gemini y
 * OpenAI construian el prompt sin nada de eso — con lo cual el feedback loop completo (calificaciones,
 * comentarios, memoria semantica) no llegaba al modelo en las instalaciones que usan esos dos.
 * Centralizarlo es la unica forma de que agregar un bloque nuevo no vuelva a dejar providers atras.
 */
export function buildScriptUserPrompt(req: ScriptGenerationRequest, jsonInstruction: string): string {
  const regenerationBlock = req.regenerationInstruction
    ? `INSTRUCCION ESPECIFICA PARA ESTA NUEVA VERSION (prioridad sobre el resto del contexto): ${req.regenerationInstruction}\n\n`
    : "";

  return `${regenerationBlock}${req.userPromptTemplate}

Tema: ${req.themeSlug}
Formato: ${req.format}
Duracion objetivo: ${req.targetDurationSeconds}s
Idea / topico especifico (base del guion): ${req.topic ?? "elige uno apropiado"}

Memoria de generaciones pasadas relevantes:
${renderMemory(req)}

No repitas exactamente estos hechos ya usados:
${req.avoidFacts.length > 0 ? req.avoidFacts.join(", ") : "Ninguno"}

Feedback reciente de la audiencia/usuario a considerar:
${renderFeedback(req)}

${renderPerformanceLearnings(req)}

${req.styleGuide ?? ""}

${jsonInstruction}`;
}

function renderMemory(req: ScriptGenerationRequest): string {
  return req.memoryContext.map((m) => `- (${m.contentType}) ${m.content}`).join("\n") || "Ninguno";
}

/**
 * El `scope` se muestra explicitamente para que el modelo no lea una nota de otro tema como una
 * instruccion sobre este. El feedback de otros temas casi siempre es sobre produccion (ritmo de la
 * voz, cortes, duracion) y ahi si aplica; sobre contenido, no.
 */
function renderFeedback(req: ScriptGenerationRequest): string {
  return (
    req.recentFeedback
      .map((f) => {
        const origin = f.scope === "channel" ? "otro tema del canal" : "este tema";
        return `- [${origin}] rating=${f.rating ?? "N/A"} comentario="${f.comment ?? ""}"`;
      })
      .join("\n") || "Ninguno"
  );
}

/**
 * Bloque de patrones medidos en todo el canal. Se le dice explicitamente al modelo que son datos
 * reales y cuantos videos respaldan cada uno, porque sin el tamano de muestra un LLM trata "3 videos
 * salieron mejor" con la misma seguridad que "40 videos salieron mejor" y sobre-corrige el estilo.
 *
 * Si no hay patrones todavia, el bloque se omite entero en vez de decir "Ninguno": una seccion vacia
 * invita al modelo a inventar sus propias reglas de rendimiento.
 */
function renderPerformanceLearnings(req: ScriptGenerationRequest): string {
  const learnings = req.performanceLearnings ?? [];
  if (learnings.length === 0) return "";

  const lines = learnings
    .map((l) => `- [${l.dimension}, ${l.sampleSize} videos] ${l.insight} ${l.recommendation}`)
    .join("\n");

  return `QUE FUNCIONA EN ESTE CANAL (medido con estadisticas reales de YouTube en todos los temas, no es opinion):
${lines}

Aplica estos patrones al escribir el guion. Son observaciones de rendimiento real, asi que tienen prioridad sobre tus preferencias de estilo por defecto — pero fijate en el numero de videos de cada uno: con pocos videos el patron es una pista, no una regla, y nunca justifica romper la coherencia del tema o la calidad de la historia.`;
}
