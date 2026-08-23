/**
 * Niveles de musica de fondo por debajo de la narracion, en dB.
 *
 * Referencias usadas (verificadas 2026-08-23):
 * - Practica profesional de edicion: la musica va 18-20 dB por debajo del dialogo/narracion.
 * - W3C WCAG, tecnica G56: el sonido que no es voz debe estar al menos 20 dB por debajo de la voz
 *   (accesibilidad — hace la voz ~4 veces mas fuerte que el fondo).
 * - Guia para locucion: con voz en off, la musica se deja entre -20 y -25 dB.
 *
 * Por eso el default es -22 dB: cumple el minimo de 20 dB de la WCAG y cae dentro del rango
 * recomendado para locucion, sin quedar tan bajo que la musica se pierda. El valor anterior del
 * repo (-18 dB) estaba en el extremo mas alto de lo aceptable y tapaba la narracion.
 *
 * Ojo con la cadena de audio en edl-to-ffmpeg.ts: `volume` se aplica solo a la musica, luego
 * `amix` (que atenua ambas entradas por igual, preservando la proporcion) y al final `loudnorm`
 * lleva la MEZCLA a -14 LUFS. Es decir, este numero define la relacion voz/musica, no el volumen
 * absoluto de salida.
 */
export const BACKGROUND_MUSIC_LEVELS = [
  { id: "suave", label: "Suave", db: -28, hint: "Apenas se nota, para que la voz domine por completo" },
  {
    id: "equilibrado",
    label: "Equilibrado",
    db: -22,
    hint: "Recomendado: se escucha sin competir con la narracion (cumple WCAG G56)",
  },
  { id: "presente", label: "Presente", db: -16, hint: "Mas protagonista; solo si la narracion es muy clara" },
] as const;

export type BackgroundMusicLevelId = (typeof BACKGROUND_MUSIC_LEVELS)[number]["id"];

/** Nivel por defecto de la musica de fondo respecto a la narracion. */
export const DEFAULT_BACKGROUND_MUSIC_DB = -22;

export function backgroundMusicDbFor(levelId: string | undefined): number {
  return BACKGROUND_MUSIC_LEVELS.find((l) => l.id === levelId)?.db ?? DEFAULT_BACKGROUND_MUSIC_DB;
}
