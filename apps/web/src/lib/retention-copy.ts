/**
 * Por que la retencion puede pasar del 100%.
 *
 * No es un error de calculo ni un dato corrupto: la metrica que devuelve YouTube
 * (`audienceWatchRatio`) cuenta cuantas veces se reprodujo ese instante del video en relacion a las
 * vistas totales, asi que un Short que la gente deja en bucle mide 180%. Sin este aviso, el numero
 * se lee como un bug del producto y hace desconfiar del resto del tablero — que es peor que el
 * propio dato raro.
 *
 * Devuelve `undefined` cuando el valor esta en el rango normal, para no llenar la pantalla de notas
 * que nadie necesita leer.
 */
export function overHundredNote(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || value <= 100) return undefined;
  return "Pasa del 100% porque YouTube cuenta las repeticiones: el video se esta viendo en bucle.";
}

/** Une la explicacion del video en bucle con el texto fijo de la casilla, si hace falta. */
export function withOverHundredNote(base: string, value: number | null | undefined): string {
  const note = overHundredNote(value);
  return note ? `${base} ${note}` : base;
}
