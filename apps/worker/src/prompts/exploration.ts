import type { DimensionCoverage, PerformanceLearning } from "@video-generator/types";

/**
 * La mitad que le faltaba al feedback loop: EXPLORAR, no solo explotar.
 *
 * El motor de aprendizaje solo sabe comparar grupos que ya existen. Si el modelo, con el mismo prompt
 * cada vez, escribe siempre el mismo tipo de gancho, nunca se forma el grupo contrario y esa
 * dimension queda muerta para siempre — no por falta de videos, sino por falta de variedad. Paso
 * exactamente eso: los primeros 10 videos medibles abrieron TODOS con pregunta, aunque la guia de
 * tono ofrecia explicitamente abrir con una afirmacion fuerte como alternativa.
 *
 * Y el bucle se aprieta solo: en cuanto una leccion se forma, entra al prompt como "prefiere X",
 * asi que el modelo se aleja todavia mas de probar Y. Sin un empujon deliberado, el sistema converge
 * a hacer siempre lo mismo y a creer que eso es lo mejor porque es lo unico que midio.
 *
 * La instruccion se deriva del propio diagnostico: se explora unicamente lo que `analyzeCoverage`
 * marca como `sin_variacion` (todos los videos en un solo grupo). Cuando el grupo que falta junta
 * suficientes videos, la dimension deja de estar bloqueada, la exploracion se apaga sola y la
 * comparacion pasa a decidirla el dato.
 */

/**
 * Que pedirle al guion para fabricar el grupo que falta, segun el grupo en el que estan atascados
 * todos los videos. Solo estan aqui las dimensiones que se pueden mover ESCRIBIENDO el guion: el
 * ritmo de corte o los efectos no se piden por prompt, se deciden en el pipeline.
 */
const MISSING_VARIANT_DIRECTIVE: Record<string, Record<string, string>> = {
  "tipo de gancho": {
    "abrir con pregunta":
      "El gancho de este video NO debe ser una pregunta: abre con una AFIRMACION tajante, un dato que" +
      " contradiga lo que la gente cree, o directo en medio de la accion. Sin signos de interrogacion" +
      " en la primera frase.",
    "abrir con afirmacion":
      "El gancho de este video debe ser una PREGUNTA que genere curiosidad inmediata, no una" +
      " afirmacion.",
  },
  "longitud del gancho": {
    "gancho de >8 palabras":
      "El gancho de este video debe ser MUY corto: la primera frase, maximo 8 palabras. Corta y seca.",
    "gancho de <=8 palabras":
      "El gancho de este video puede ser mas largo de lo habitual (10-15 palabras en la primera frase)," +
      " para montar una situacion mas concreta antes del giro.",
  },
  "dato concreto en el gancho": {
    "gancho sin numero/dato":
      "El gancho de este video debe incluir un NUMERO o dato concreto (un año, una cantidad, un" +
      " porcentaje) en la primera frase.",
    "gancho con numero/dato":
      "El gancho de este video NO debe apoyarse en un numero: engancha con una imagen o una situacion" +
      " concreta, sin cifras en la primera frase.",
  },
};

/**
 * Experimentos que NO se piden escribiendo el guion, sino cambiando una decision del pipeline.
 *
 * Existen porque al aplicar las buenas practicas de retencion (golpe visual en el gancho, cortes de
 * ~5s) esas decisiones quedaron fijas para todos los videos, y una decision fija no se puede medir:
 * nunca existe el grupo contrario. Es el precio de seguir una recomendacion general — se gana la
 * mejora, se pierde la posibilidad de comprobarla en ESTE canal. Estos experimentos recuperan lo
 * segundo sin renunciar a lo primero, desviandose solo de vez en cuando.
 *
 * `apply` describe la desviacion en datos, no en prosa, porque quien la ejecuta es otro stage
 * (el EDL) o el propio calculo de escenas — no un LLM leyendo instrucciones.
 */
export interface PipelineExperimentPlan {
  /** Efecto forzado en la primera escena, en vez del golpe visual por defecto. */
  hookEffect?: "none" | "ken_burns";
  /** Segundos de narracion por escena, en vez de `SECONDS_PER_SCENE`. Cambia cuantos cortes hay. */
  secondsPerScene?: number;
  /**
   * A que mitad de la banda de duracion apuntar: `corto` estrecha el rango al piso, `largo` al techo.
   *
   * Nunca sube el techo — ese lo puso el usuario. Lo unico que hace es dejar de pedir "cualquier
   * punto de la banda" para pedir un extremo concreto, que es lo que fabrica los dos grupos que la
   * dimension de aprovechamiento necesita comparar.
   */
  durationBias?: "corto" | "largo";
}

export interface ExplorationChoice {
  dimension: string;
  /** `desbloqueo`: la dimension no puede aprender. `reprueba`: ya hay leccion, se pone a prueba. */
  kind: "desbloqueo" | "reprueba";
  /** El grupo cuya alternativa se va a producir (el saturado, o el ganador que se pone a prueba). */
  referenceBucket: string;
  /** Instruccion para el LLM, si el experimento se pide escribiendo el guion. */
  directive?: string;
  /** Desviacion del pipeline, si el experimento se aplica montando el video. */
  plan?: PipelineExperimentPlan;
  /** Por que se explora esto, en una frase. Va al prompt y al log. */
  reason: string;
}

/**
 * Desviaciones de pipeline por dimension y por el grupo en el que estan atascados los videos.
 *
 * Ojo con el criterio: lo que se produce tiene que caer de verdad en el OTRO grupo al medirlo. Un
 * `secondsPerScene` de 6 seguiria cayendo en "cortes medios (4-7s)" y el experimento no habria
 * construido nada; por eso los valores se eligen mirando los cortes de los buckets en `learnings.ts`.
 */
const PIPELINE_VARIANTS: Record<string, Record<string, { plan: PipelineExperimentPlan; describes: string }>> = {
  "golpe visual en el gancho": {
    "gancho con golpe visual": {
      plan: { hookEffect: "ken_burns" },
      describes: "abrir con un movimiento suave en vez de un golpe de zoom",
    },
    "gancho sin golpe visual": {
      plan: { hookEffect: "none" },
      describes: "abrir con el plano quieto",
    },
  },
  // El techo de duracion lo elige el usuario y suele ser siempre el mismo (los primeros 32 videos
  // del canal pidieron 90s salvo uno), asi que sin empujon todos los guiones se escriben apuntando
  // al mismo sitio de la banda y la dimension nace muerta. Apuntar a un extremo concreto es la unica
  // forma de que existan los dos grupos, y es gratis: las dos duraciones son validas para el usuario.
  "aprovechamiento de la duracion": {
    "cerca del techo pedido": {
      plan: { durationBias: "corto" },
      describes: "cerrar la historia bastante antes del tiempo maximo permitido",
    },
    "bastante por debajo del techo": {
      plan: { durationBias: "largo" },
      describes: "aprovechar casi todo el tiempo maximo permitido",
    },
  },
  "ritmo de corte": {
    "cortes rapidos (<=4s por escena)": {
      plan: { secondsPerScene: 9 },
      describes: "cortar mucho mas lento de lo habitual",
    },
    "cortes medios (4-7s por escena)": {
      plan: { secondsPerScene: 9 },
      describes: "cortar mas lento de lo habitual",
    },
    "cortes lentos (>7s por escena)": {
      plan: { secondsPerScene: 3.5 },
      describes: "cortar mucho mas rapido de lo habitual",
    },
  },
};

/** Solo se puede experimentar con lo que se sabe pedir por prompt. */
function directiveAgainst(dimension: string, bucket: string): string | undefined {
  return MISSING_VARIANT_DIRECTIVE[dimension]?.[bucket];
}

function pipelineAgainst(dimension: string, bucket: string) {
  return PIPELINE_VARIANTS[dimension]?.[bucket];
}

/**
 * Cada cuanto volver a probar la opcion perdedora de una leccion YA formada.
 *
 * Explotar siempre lo aprendido es la trampa clasica del problema explorar/explotar: una leccion
 * sacada de tres videos contra tres puede ser ruido, y si nunca se vuelve a probar la alternativa,
 * el sistema se queda atascado en una opcion subóptima creyendo que la midio. Por eso se sigue
 * probando incluso cuando ya hay veredicto.
 *
 * Baja conforme crece el canal (`1/√n`): con 10 videos la evidencia es fragil y conviene dudar
 * seguido; con 400 la leccion ya se gano el derecho a mandar. El piso mantiene una rendija abierta
 * para siempre, porque lo que funciona en un canal cambia con el tiempo.
 */
function retestProbability(sampleCount: number): number {
  if (sampleCount <= 0) return 0;
  return Math.min(0.3, Math.max(0.05, 1 / Math.sqrt(sampleCount)));
}

/**
 * Elige UNA dimension para experimentar con este video, o null si no hay nada que probar.
 *
 * Una sola a la vez a proposito: cambiar el gancho y su longitud y su uso de numeros en el mismo
 * video daria un video raro del que despues no se puede atribuir nada — si rinde distinto, no se
 * sabria cual de los tres cambios lo causo. De una en una, cada experimento es legible.
 *
 * Primero se agotan las dimensiones bloqueadas, porque ahi la exploracion es informacion gratis: no
 * se esta renunciando a nada conocido, simplemente no hay nada medido. Solo cuando no queda ninguna
 * bloqueada se paga el precio de re-probar una opcion que ya perdio.
 */
export function chooseExploration(
  coverage: DimensionCoverage[],
  learnings: PerformanceLearning[],
  sampleCount: number,
  random: () => number = Math.random,
): ExplorationChoice | null {
  for (const entry of coverage) {
    if (entry.status !== "sin_variacion") continue;
    const saturated = entry.groups[0]?.label;
    if (!saturated) continue;
    const reason = `todos los videos anteriores del canal cayeron en "${saturated}", asi que no hay con que compararlo y no se puede saber si es lo mejor. Este video construye el grupo que falta`;

    const directive = directiveAgainst(entry.dimension, saturated);
    if (directive) {
      return { dimension: entry.dimension, kind: "desbloqueo", referenceBucket: saturated, directive, reason };
    }
    const pipeline = pipelineAgainst(entry.dimension, saturated);
    if (pipeline) {
      return {
        dimension: entry.dimension,
        kind: "desbloqueo",
        referenceBucket: saturated,
        plan: pipeline.plan,
        reason,
      };
    }
  }

  if (random() >= retestProbability(sampleCount)) return null;

  // Se re-prueba la leccion con evidencia mas debil: la que menos muestra efectiva tiene detras es
  // la que mas probablemente sea casualidad, y por lo tanto donde mas se gana volviendo a mirar.
  const retestable = learnings
    .filter((l) => {
      const winner = l.buckets[0]?.label;
      if (!winner || l.buckets.length < 2) return false;
      return Boolean(directiveAgainst(l.dimension, winner) ?? pipelineAgainst(l.dimension, winner));
    })
    .sort((a, b) => weakestEvidence(a) - weakestEvidence(b));

  const target = retestable[0];
  if (!target) return null;

  const winner = target.buckets[0]!;
  const reason = `ya hay una leccion que dice preferir "${winner.label}", pero se midio con poca muestra (${winner.count} video(s) en el grupo ganador) y podria ser casualidad. Este video la pone a prueba a proposito`;

  return {
    dimension: target.dimension,
    kind: "reprueba",
    referenceBucket: winner.label,
    directive: directiveAgainst(target.dimension, winner.label),
    plan: pipelineAgainst(target.dimension, winner.label)?.plan,
    reason,
  };
}

/** La muestra efectiva del grupo mas flaco de una leccion: lo que de verdad la sostiene. */
function weakestEvidence(learning: PerformanceLearning): number {
  return Math.min(...learning.buckets.map((b) => b.effectiveCount));
}

/**
 * El bloque que se le agrega al prompt. Va aparte para que se lea como lo que es: un experimento.
 *
 * Devuelve null para los experimentos de pipeline: ahi no hay nada que pedirle al LLM (la desviacion
 * la aplica el montaje), y meterle un parrafo sobre efectos solo lo distraeria del guion.
 */
export function buildExplorationBlock(choice: ExplorationChoice): string | null {
  if (!choice.directive) return null;
  return `EXPERIMENTO DE ESTE VIDEO (obligatorio, tiene prioridad sobre la guia de tono y sobre los patrones aprendidos):
${choice.directive}

Se pide a proposito: ${choice.reason}. Cumple la instruccion aunque tu instinto (o los patrones de arriba) te lleven al otro lado, y sin sacrificar la calidad de la historia.`;
}
