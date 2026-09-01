import { getDiscoveryEligibility } from "@video-generator/analytics";
import { enqueueDimensionDiscovery } from "@/lib/queue";
import { NextResponse } from "next/server";

/**
 * Pide a la IA que proponga dimensiones de aprendizaje nuevas leyendo los guiones que mejor y peor
 * rindieron. El trabajo real lo hace el worker (llama al LLM y clasifica el canal entero).
 *
 * Revalida la elegibilidad aunque la UI ya haya deshabilitado el boton: el estado pudo cambiar entre
 * que se pinto la pantalla y que se apreto, y este endpoint es lo que de verdad gasta llamadas.
 */
export async function POST() {
  const eligibility = await getDiscoveryEligibility();

  if (!eligibility.enabled) {
    return NextResponse.json({ error: `${eligibility.reason} ${eligibility.unlockHint}` }, { status: 409 });
  }

  await enqueueDimensionDiscovery();
  return NextResponse.json({ queued: true, samples: eligibility.usableSamples });
}
