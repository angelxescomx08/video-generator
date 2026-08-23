"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MusicTrack } from "@video-generator/db";
import {
  YOUTUBE_AUDIO_GENRE_LABELS_ES,
  YOUTUBE_AUDIO_MOOD_LABELS_ES,
  type YoutubeAudioGenre,
  type YoutubeAudioMood,
} from "@video-generator/types";

export function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MusicLibraryList({ tracks }: { tracks: MusicTrack[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(track: MusicTrack) {
    if (!confirm(`Borrar "${track.title}"? Se elimina el archivo del disco.`)) return;
    setDeletingId(track.id);
    setError(null);
    try {
      const response = await fetch(`/api/music/${track.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "No se pudo borrar");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setDeletingId(null);
    }
  }

  if (tracks.length === 0) {
    return (
      <p className="rounded-md border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
        Todavia no hay canciones. Sube una arriba y podras ponersela a cualquier video sin volver a
        generar el guion ni la voz.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <ul className="space-y-2">
        {tracks.map((track) => (
          <li key={track.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{track.title}</p>
                <p className="text-xs text-muted-foreground">
                  {track.artist ? `${track.artist} · ` : ""}
                  {formatDuration(track.durationSeconds)}
                  {track.sizeBytes ? ` · ${(track.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={deletingId === track.id}
                onClick={() => onDelete(track)}
              >
                {deletingId === track.id ? "Borrando..." : "Borrar"}
              </Button>
            </div>

            {(track.genres.length > 0 || track.moods.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {track.genres.map((g) => (
                  <Badge key={g} variant="default">
                    {YOUTUBE_AUDIO_GENRE_LABELS_ES[g as YoutubeAudioGenre] ?? g}
                  </Badge>
                ))}
                {track.moods.map((m) => (
                  <Badge key={m} variant="secondary">
                    {YOUTUBE_AUDIO_MOOD_LABELS_ES[m as YoutubeAudioMood] ?? m}
                  </Badge>
                ))}
              </div>
            )}

            {track.attribution && (
              <p className="text-xs text-muted-foreground">Credito: {track.attribution}</p>
            )}

            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls preload="none" src={`/api/music/${track.id}/file`} className="h-8 w-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
