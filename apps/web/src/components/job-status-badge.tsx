"use client";

import { useEffect, useState } from "react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { GenerationProgress } from "@/components/generation-progress";
import type { Video } from "@video-generator/db";

const TERMINAL_STATUSES = new Set(["ready", "published", "failed"]);

export function VideoStatusPanel({ initialVideo }: { initialVideo: Video }) {
  const [video, setVideo] = useState(initialVideo);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(video.status)) return;
    const interval = setInterval(async () => {
      const response = await fetch(`/api/videos/${video.id}`);
      if (response.ok) setVideo(await response.json());
    }, 3000);
    return () => clearInterval(interval);
  }, [video.status, video.id]);

  return (
    <div className="space-y-4">
      <GenerationProgress status={video.status} />

      <div className="flex items-center gap-3">
        <Badge variant={statusVariant(video.status)}>{video.status}</Badge>
        {!TERMINAL_STATUSES.has(video.status) && (
          <span className="text-sm text-muted-foreground">Actualizando automaticamente...</span>
        )}
      </div>

      {video.errorMessage && <p className="text-sm text-destructive">{video.errorMessage}</p>}

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
