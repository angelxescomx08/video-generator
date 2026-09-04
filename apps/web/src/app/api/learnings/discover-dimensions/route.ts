import { getDiscoveryEligibility, getLatestDiscoveryRun } from "@video-generator/analytics";
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

  // La corrida ANTERIOR se devuelve junto con el encolado para que el cliente pueda distinguir "el
  // worker todavia no toma el job" de "ya termino": entre el POST y el insert que hace el handler no
  // existe ninguna fila `running`, asi que sin esta marca un sondeo inmediato veria la corrida vieja
  // y anunciaria que termino algo que ni siquiera empezo.
  const previous = await getLatestDiscoveryRun();
  await enqueueDimensionDiscovery();

  return NextResponse.json({
    queued: true,
    samples: eligibility.usableSamples,
    previousRunId: previous?.id ?? null,
  });
}

/** Sondeo del boton mientras dura el job. Consulta barata a proposito — ver `getLatestDiscoveryRun`. */
export async function GET() {
  return NextResponse.json({ run: await getLatestDiscoveryRun() });
}
