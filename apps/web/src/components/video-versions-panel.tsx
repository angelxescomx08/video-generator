"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VideoVersion } from "@video-generator/db";

type VersionWithFlag = VideoVersion & { isCurrent: boolean };

export function VideoVersionsPanel({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [versions, setVersions] = useState<VersionWithFlag[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function load() {
    const response = await fetch(`/api/videos/${videoId}/versions`);
    if (response.ok) setVersions(await response.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  async function onRestore(versionId: string) {
    if (!confirm("Restaurar esta version? Reemplazara el guion y el render actual del video.")) return;
    setRestoringId(versionId);
    try {
      const response = await fetch(`/api/videos/${videoId}/versions/${versionId}/activate`, { method: "POST" });
      if (response.ok) {
        await load();
        router.refresh();
      }
    } finally {
      setRestoringId(null);
    }
  }

  if (!versions || versions.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Versiones</h3>
      <ul className="space-y-2">
        {versions.map((v) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">v{v.versionNumber}</span>
              {v.isCurrent && <Badge>Actual</Badge>}
              <span className="text-muted-foreground">
                {new Date(v.createdAt).toLocaleString()}
                {v.durationSeconds ? ` · ${v.durationSeconds}s` : ""}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href={`/api/videos/${videoId}/versions/${v.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                Ver
              </a>
              <Button
                variant="outline"
                size="sm"
                disabled={v.isCurrent || restoringId === v.id}
                onClick={() => onRestore(v.id)}
              >
                {restoringId === v.id ? "Restaurando..." : "Restaurar esta version"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
