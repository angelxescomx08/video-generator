/**
 * La duracion de un video no es un numero, es una BANDA [minimo, maximo].
 *
 * Antes se pedia un unico "objetivo" y el presupuesto de palabras se armaba +-10% alrededor de el,
 * asi que el techo real quedaba POR ENCIMA de lo pedido: pedir 90s permitia 99s y los videos del
 * canal salieron entre 72s y 99s. Eso convierte el numero que escribe el usuario en una sugerencia
 * difusa en vez de en un limite.
 *
 * El contrato nuevo es el opuesto y mas simple de explicar: **lo que el usuario escribe es el TECHO**.
 * El guion se escribe para caer en cualquier punto de la banda, con la unica regla dura de no pasarse
 * del techo. Sigue siendo posible desbordar por unos pocos segundos porque la conversion
 * palabras->segundos es una estimacion (`WORDS_PER_MINUTE`) y el TTS real no narra exactamente a ese
 * ritmo; lo que desaparece es el margen de 10% que se estaba regalando a proposito.
 */

/** Palabras por minuto de narracion en espanol (ritmo natural, ni lento ni atropellado). */
export const WORDS_PER_MINUTE = 150;

/**
 * Limites duros por formato, y el techo por defecto si el usuario no elige uno.
 *
 * - `short.max = 180`: limite de la plataforma. YouTube subio los Shorts de 60s a 3 minutos para
 *   videos subidos despues del 15 de octubre de 2024; pasarse de ahi deja de ser un Short.
 * - `short.min = 15`: YouTube no publica un minimo, asi que este es un minimo EDITORIAL, no tecnico.
 *   Las referencias de retencion para formato corto ubican el punto dulce en 30-45s y la banda mas
 *   corta util en 15-30s: por debajo de ~15s no cabe gancho + desarrollo + pago de la promesa, y lo
 *   que sale es un dato suelto sin historia. Nada impide subirlo; lo que no tiene sentido es bajarlo.
 * - `long.min = 60`: por debajo de un minuto el video ya es un Short mal etiquetado (vertical o no,
 *   YouTube lo clasifica por duracion), asi que pedir "video largo" de 40s es contradictorio.
 */
export const DURATION_LIMITS = {
  short: { min: 15, max: 180, default: 90 },
  long: { min: 60, max: 1800, default: 300 },
} as const;

/**
 * Que tan por debajo del techo puede quedarse el guion.
 *
 * Es la holgura que pidio existir: con 1.0 volveriamos a un tiempo exacto y con algo como 0.5 un
 * video de "90 segundos" podria salir de 45 y no seria lo que se pidio. 0.75 abre una banda de un
 * cuarto del techo (90s -> 68-90s), mas ancha que el +-10% de antes, pero sin que la duracion final
 * deje de parecerse a la pedida.
 */
const MIN_RATIO = 0.75;

export interface DurationBand {
  /** Piso: por debajo de aqui el guion se quedo corto. */
  minSeconds: number;
  /** Techo: la regla dura. Pasarse es un error, no una aproximacion. */
  maxSeconds: number;
}

export function clampDurationToLimits(format: "long" | "short", seconds: number): number {
  const limits = DURATION_LIMITS[format];
  return Math.min(Math.max(Math.round(seconds), limits.min), limits.max);
}

/**
 * La banda en la que debe caer el video, a partir del techo que eligio el usuario.
 *
 * El piso se deriva en vez de guardarse: es una consecuencia del techo, y almacenarlo obligaria a
 * migrar los videos viejos cada vez que se afine `MIN_RATIO`. Nunca baja del minimo del formato, asi
 * que un techo ya de por si corto (un Short de 20s) no genera una banda absurda de 15-20s.
 */
export function resolveDurationBand(format: "long" | "short", targetDurationSeconds: number | null): DurationBand {
  const limits = DURATION_LIMITS[format];
  const maxSeconds = clampDurationToLimits(format, targetDurationSeconds ?? limits.default);
  const minSeconds = Math.max(limits.min, Math.min(maxSeconds, Math.round(maxSeconds * MIN_RATIO)));
  return { minSeconds, maxSeconds };
}

export interface WordBudget {
  minWords: number;
  maxWords: number;
}

/**
 * La banda de segundos traducida a palabras de narracion.
 *
 * La comparten el prompt (que la pide) y el recorte deterministico post-generacion
 * (`clampScenesToWordBudget`, que la impone) para que ambos midan "se paso" con el mismo criterio.
 * `maxWords` ya no lleva margen extra: es exactamente lo que cabe en el techo.
 */
export function computeWordBudget(band: DurationBand): WordBudget {
  return {
    minWords: Math.round((band.minSeconds / 60) * WORDS_PER_MINUTE),
    maxWords: Math.round((band.maxSeconds / 60) * WORDS_PER_MINUTE),
  };
}
