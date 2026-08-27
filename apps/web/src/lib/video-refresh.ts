"use client";

import { useEffect, useRef } from "react";

/**
 * Bus minimo para que todos los paneles del detalle de video se refresquen juntos.
 *
 * `router.refresh()` solo re-renderiza los componentes de SERVIDOR. Los paneles que traen sus datos
 * con `fetch` desde el cliente (versiones, costos) se quedaban con lo que cargaron al montar, asi que
 * despues de un cambio de musica, un re-render o una publicacion la pagina se veia a medias hasta
 * recargar a mano — de ahi la sensacion de que "la interfaz no se refresca".
 *
 * Quien detecta el cambio (el panel de estado, o la accion que acaba de encolar algo) llama a
 * `notifyVideoChanged`; los paneles client-side escuchan con `useVideoDataRefresh` y recargan.
 */
const EVENT = "video-data-changed";

export function notifyVideoChanged(videoId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { videoId } }));
}

/**
 * Llama a `onChange` cuando: (a) alguien anuncio un cambio en este video, o (b) la pestana vuelve a
 * estar visible / recibe el foco. Lo segundo cubre el caso mas comun de UI vieja: dejar la pestana
 * en segundo plano mientras el worker trabaja y volver a ella minutos despues.
 */
export function useVideoDataRefresh(videoId: string, onChange: () => void): void {
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ videoId?: string }>).detail;
      if (!detail?.videoId || detail.videoId === videoId) callback.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") callback.current();
    };

    window.addEventListener(EVENT, onEvent);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(EVENT, onEvent);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [videoId]);
}
