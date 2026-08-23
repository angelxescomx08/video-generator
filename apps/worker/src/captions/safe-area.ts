/**
 * Margenes seguros para subtitulos quemados, en pixeles sobre el lienzo real del video.
 *
 * YouTube dibuja su propia UI ENCIMA del video, asi que un subtitulo pegado al borde inferior queda
 * tapado por el titulo, el nombre del canal y el boton de suscribirse. Medidas de referencia para un
 * Short de 1080x1920 (ver enlaces al final):
 *
 * - Abajo: los ultimos ~450px estan ocupados por titulo/descripcion, nombre del canal y CTA.
 * - Derecha: los ultimos ~150px son la columna de botones (like / dislike / comentar / compartir).
 * - Arriba: los primeros ~120px llevan la info del canal y el buscador.
 * - Recomendacion general: mantener texto dentro del 80% central del ancho y fuera del 20% inferior.
 *
 * Elegimos MarginV = 500px (por encima de los 450px de UI, con holgura) y margenes laterales de
 * 160px, que dejan el texto en x=160..920 y por tanto fuera de la columna de botones (930..1080).
 * Los margenes laterales se mantienen simetricos a proposito: con Alignment=2 el texto va centrado,
 * y unos margenes asimetricos lo descentrarian visualmente.
 *
 * Fuentes:
 * - https://imagevideofit.com/guides/youtube-shorts-safe-zone
 * - https://www.somake.ai/blog/youtube-shorts-aspect-ratio
 * - https://flixier.com/tools/safe-zones-for-social-media-videos/youtube-shorts-safe-zones
 */
export interface CaptionSafeArea {
  marginLeft: number;
  marginRight: number;
  /** Distancia al borde inferior (Alignment=2) o superior (Alignment=8). */
  marginVertical: number;
}

/** Alto de la UI inferior de Shorts que tapa el video (titulo + canal + CTA de suscripcion). */
const SHORTS_BOTTOM_UI_PX = 450;
/** Ancho de la columna de botones de accion a la derecha en Shorts. */
const SHORTS_RIGHT_UI_PX = 150;
/** Alto de la barra superior de Shorts (info del canal / buscador). */
const SHORTS_TOP_UI_PX = 120;

export function captionSafeArea(
  format: "long" | "short",
  position: "bottom" | "center" | "top",
): CaptionSafeArea {
  if (format !== "short") {
    // Horizontal (1920x1080): no hay UI encima del video en el reproductor normal, pero la barra de
    // controles aparece al pasar el mouse — 80px abajo la deja libre.
    return { marginLeft: 120, marginRight: 120, marginVertical: position === "top" ? 80 : 80 };
  }

  const lateral = SHORTS_RIGHT_UI_PX + 10;
  if (position === "top") {
    return { marginLeft: lateral, marginRight: lateral, marginVertical: SHORTS_TOP_UI_PX + 40 };
  }
  if (position === "center") {
    // Alignment=5 centra vertical y practicamente ignora MarginV; los laterales si aplican.
    return { marginLeft: lateral, marginRight: lateral, marginVertical: 0 };
  }
  return { marginLeft: lateral, marginRight: lateral, marginVertical: SHORTS_BOTTOM_UI_PX + 50 };
}
