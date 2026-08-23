"use client";

import { useEffect, useState } from "react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GenerationProgress } from "@/components/generation-progress";
import type { Video } from "@video-generator/db";

const TERMINAL_STATUSES = new Set(["ready", "published", "failed"]);

export function VideoStatusPanel({ initialVideo }: { initialVideo: Video }) {
  const [video, setVideo] = useState(initialVideo);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(video.status)) return;
    const interval = setInterval(async () => {
      const response = await fetch(`/api/videos/${video.id}`);
      if (response.ok) setVideo(await response.json());
    }, 3000);
    return () => clearInterval(interval);
  }, [video.status, video.id]);

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
      <GenerationProgress status={video.status} />

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

      {retryError && <p className="text-sm text-destructive">{retryError}</p>}

      {video.errorMessage && <p className="text-sm text-destructive">{video.errorMessage}</p>}

      {video.description && (
        <div className="space-y-1">
          <h3 className="font-semibold">Descripcion (YouTube)</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{video.description}</p>
        </div>
      )}

      {video.tags && video.tags.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold">Tags</h3>
          <div className="flex flex-wrap gap-1">
            {video.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

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
