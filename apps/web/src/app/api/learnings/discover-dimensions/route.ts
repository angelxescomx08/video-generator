import { getLearningReadiness } from "@video-generator/analytics";
import { enqueueDimensionDiscovery } from "@/lib/queue";
import { NextResponse } from "next/server";

/** Videos medibles minimos para que buscar patrones tenga sentido. Espeja el guard del handler. */
const MIN_SAMPLES = 6;

/**
 * Pide a la IA que proponga dimensiones de aprendizaje nuevas leyendo los guiones que mejor y peor
 * rindieron. El trabajo real lo hace el worker (llama al LLM y clasifica el canal entero); aqui solo
 * se valida que haya muestra suficiente antes de gastar en llamadas.
 */
export async function POST() {
  const readiness = await getLearningReadiness();

  if (readiness.usableSamples < MIN_SAMPLES) {
    return NextResponse.json(
      {
        error: `Hacen falta al menos ${MIN_SAMPLES} videos con estadisticas utilizables y hay ${readiness.usableSamples}. Con menos, cualquier patron que encuentre la IA es ruido.`,
      },
      { status: 409 },
    );
  }

  await enqueueDimensionDiscovery();
  return NextResponse.json({ queued: true, samples: readiness.usableSamples });
}
