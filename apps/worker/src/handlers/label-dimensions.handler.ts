import { labelMissingDimensions } from "../learning/label-dimensions";

/**
 * Rellena las etiquetas que falten de las dimensiones descubiertas activas.
 *
 * No lleva payload: mira el canal entero y hace lo que falte. Se dispara desde tres sitios, y los
 * tres son a proposito el mismo trabajo idempotente:
 * - al terminar de publicar un video (para que entre a las preguntas abiertas cuanto antes),
 * - en el cron de estadisticas cada 6h (la red de seguridad: recoge lo que se haya perdido),
 * - al terminar un descubrimiento (etiqueta las preguntas recien nacidas contra todo el canal).
 */
export async function handleLabelDimensions(): Promise<void> {
  await labelMissingDimensions();
}
