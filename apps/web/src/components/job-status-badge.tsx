"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GenerationProgress } from "@/components/generation-progress";
import type { Video } from "@video-generator/db";

const TERMINAL_STATUSES = new Set(["ready", "published", "failed"]);

export function VideoStatusPanel({ initialVideo }: { initialVideo: Video }) {
  const router = useRouter();
  const [video, setVideo] = useState(initialVideo);
  // Si ya hay un render activo, lo que corre es solo un re-render (p.ej. cambio de musica): el
  // guion, la voz y los clips ya estan hechos y no se vuelven a generar.
  const renderOnly = Boolean(initialVideo.currentVersionId);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  /**
   * Status con el que acabo de terminar el trabajo, mientras esta pestana estuvo abierta.
   *
   * El refresco de los componentes de servidor es silencioso: aparece la seccion "Publicar" y ya, que
   * es facil no notar si estabas mirando otra cosa. Este aviso hace explicito el momento en que
   * termino, y solo se muestra si el cambio ocurrio con la pagina abierta — al recargar desaparece,
   * porque ahi el estado ya se ve en el badge.
   */
  const [justFinished, setJustFinished] = useState<string | null>(null);

  /**
   * Adopta el estado que manda el servidor cuando cambia.
   *
   * `useState(initialVideo)` solo corre en el primer montaje, asi que sin esto el panel se quedaba
   * congelado ante cualquier `router.refresh()`: al encolar un re-render el servidor ya decia
   * "rendering" pero el panel seguia mostrando "ready" y nunca arrancaba el polling — el boton parecia
   * no hacer nada.
   *
   * Comparar el status antes de asignar evita el bucle: `initialVideo` es un objeto nuevo en cada
   * render, pero si el status coincide se devuelve `prev` y React no vuelve a renderizar.
   */
  useEffect(() => {
    setVideo((prev) => (prev.status === initialVideo.status ? prev : initialVideo));
  }, [initialVideo]);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(video.status)) return;
    const interval = setInterval(async () => {
      const response = await fetch(`/api/videos/${video.id}`);
      if (!response.ok) return;
      const next: Video = await response.json();
      setVideo(next);

      // Al terminar hay que refrescar los componentes de SERVIDOR, no solo este panel: la seccion
      // "Publicar", el historial de versiones y los costos se renderizan en el servidor y estaban
      // quedandose con los datos del primer render. De ahi venia la sensacion de que la UI no avisaba:
      // el badge cambiaba a "ready" pero el resto de la pagina seguia como si nada hasta recargar.
      if (TERMINAL_STATUSES.has(next.status)) {
        setJustFinished(next.status);
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [video.status, video.id, router]);

  async function onRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/videos/${video.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "No se pudo reintentar");
      setVideo(await response.json());
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="space-y-4">
      <GenerationProgress status={video.status} renderOnly={renderOnly} />

      <div className="flex items-center gap-3">
        <Badge variant={statusVariant(video.status)}>{video.status}</Badge>
        {!TERMINAL_STATUSES.has(video.status) && (
          <span className="text-sm text-muted-foreground">Actualizando automaticamente...</span>
        )}
        {video.status === "failed" && (
          <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
            {retrying ? "Reintentando..." : "Reintentar"}
          </Button>
        )}
      </div>

      {justFinished && (
        <div
          className={
            justFinished === "failed"
              ? "rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
              : "rounded-md border border-border bg-muted/50 p-3 text-sm"
          }
        >
          {justFinished === "failed"
            ? "El proceso termino con error. El detalle esta abajo."
            : "Listo, el proceso termino. La pagina ya se actualizo con el resultado."}
        </div>
      )}

      {retryError && <p className="text-sm text-destructive">{retryError}</p>}

      {video.errorMessage && <p className="text-sm text-destructive">{video.errorMessage}</p>}

      {/* Titulo, descripcion y tags viven en YoutubeMetadataPanel (seccion "Metadata para YouTube"),
          que ademas muestra los limites de caracteres y que parte se ve en el feed. */}

      {video.script && (
        <div className="space-y-1">
          <h3 className="font-semibold">Guion</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{video.script}</p>
        </div>
      )}

      {video.renderOutputPath && (
        <div className="space-y-1">
          <h3 className="font-semibold">Video renderizado</h3>
          <p className="text-sm text-muted-foreground">{video.renderOutputPath}</p>
          <video controls className="mt-2 max-w-md rounded-md border border-border">
            <source src={`/api/videos/${video.id}/file`} type="video/mp4" />
          </video>
        </div>
      )}
    </div>
  );
}
