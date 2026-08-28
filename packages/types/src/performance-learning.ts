/**
 * Un patron medido sobre TODO el canal cruzando como se hizo cada video contra como le fue.
 *
 * Vive en `types` y no en `ai-providers` porque tiene dos consumidores que no se conocen entre si:
 * el prompt del guion (packages/ai-providers) y las pantallas de analiticas (apps/web), y ninguno
 * de los dos deberia tener que depender del otro para leer esta forma.
 *
 * Lo calcula `@video-generator/analytics`.
 */
export interface PerformanceLearning {
  /** Que se comparo (p.ej. "tipo de gancho"). */
  dimension: string;
  /** El patron observado, con sus numeros. */
  insight: string;
  /** Que hacer con eso al escribir el proximo guion. */
  recommendation: string;
  /** Puntos porcentuales de diferencia entre el mejor y el peor grupo. */
  deltaPoints: number;
  /** Videos que respaldan la comparacion. */
  sampleSize: number;
  /** El grupo que rinde mejor y el que rinde peor, con su promedio y su muestra. Es lo que permite
   * dibujar la comparacion en la UI en vez de solo leer la frase de `insight`. */
  buckets: PerformanceBucket[];
  /** Nombre de la metrica con la que se califico esta dimension ("porcentaje del video visto"). */
  outcomeLabel: string;
}

export interface PerformanceBucket {
  label: string;
  /** Promedio de la metrica en este grupo, en porcentaje. */
  mean: number;
  /** Videos que caen en este grupo. */
  count: number;
}
