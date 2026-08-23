"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { MusicTrack } from "@video-generator/db";
import {
  BACKGROUND_MUSIC_LEVELS,
  YOUTUBE_AUDIO_GENRE_LABELS_ES,
  type YoutubeAudioGenre,
  type YoutubeAudioSuggestion,
} from "@video-generator/types";

const NO_MUSIC = "__none__";

/**
 * Cambia la musica de fondo del video. Cada cambio dispara solo un re-render (ffmpeg) y queda como
 * una version nueva, asi que se puede volver a la anterior desde el panel de versiones.
 */
export function VideoMusicPanel({
  videoId,
  tracks,
  currentTrackId,
  currentLabel,
  suggestion,
  disabled,
}: {
  videoId: string;
  tracks: MusicTrack[];
  currentTrackId: string | null;
  currentLabel: string | null;
  suggestion: YoutubeAudioSuggestion | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentTrackId ?? NO_MUSIC);
  const [level, setLevel] = useState<string>("equilibrado");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Canciones cuyo genero coincide con lo que la IA sugirio para este video: atajo util cuando la
  // biblioteca ya tiene muchas pistas.
  const suggestedIds = new Set(
    suggestion
      ? tracks
          .filter(
            (t) =>
              t.genres.some((g) => suggestion.genres.includes(g as YoutubeAudioGenre)) ||
              t.moods.some((m) => suggestion.moods.includes(m as never)),
          )
          .map((t) => t.id)
      : [],
  );

  const unchanged = selected === (currentTrackId ?? NO_MUSIC);

  async function onApply() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/videos/${videoId}/music`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          musicTrackId: selected === NO_MUSIC ? null : selected,
          level: selected === NO_MUSIC ? undefined : level,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "No se pudo aplicar la musica");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Musica de fondo</h3>
        <Badge variant={currentLabel ? "default" : "secondary"}>
          {currentLabel ? `Ahora: ${currentLabel}` : "Sin musica"}
        </Badge>
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        {tracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tienes canciones en la biblioteca.{" "}
            <Link href="/music" className="underline hover:text-foreground">
              Sube una
            </Link>{" "}
            para poder ponersela a este video.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="music-select">Cancion</Label>
              <Select id="music-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value={NO_MUSIC}>Sin musica (solo narracion)</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {suggestedIds.has(t.id) ? "★ " : ""}
                    {t.title}
                    {t.artist ? ` — ${t.artist}` : ""}
                  </option>
                ))}
              </Select>
              {suggestedIds.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  ★ = coincide con el genero/animo que la IA sugirio para este video
                  {suggestion && suggestion.genres.length > 0
                    ? ` (${suggestion.genres
                        .map((g) => YOUTUBE_AUDIO_GENRE_LABELS_ES[g as YoutubeAudioGenre] ?? g)
                        .join(", ")})`
                    : ""}
                  .
                </p>
              )}
            </div>

            {selected !== NO_MUSIC && (
              <div className="space-y-2">
                <Label htmlFor="music-level">Volumen respecto a la voz</Label>
                <Select id="music-level" value={level} onChange={(e) => setLevel(e.target.value)}>
                  {BACKGROUND_MUSIC_LEVELS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label} ({l.db} dB)
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  {BACKGROUND_MUSIC_LEVELS.find((l) => l.id === level)?.hint}
                </p>
              </div>
            )}

            {selected !== NO_MUSIC && (
              /* eslint-disable-next-line jsx-a11y/media-has-caption */
              <audio controls preload="none" src={`/api/music/${selected}/file`} className="h-8 w-full" />
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="space-y-1">
              <Button type="button" size="sm" disabled={disabled || submitting || unchanged} onClick={onApply}>
                {submitting ? "Aplicando..." : "Aplicar y crear version"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {disabled
                  ? "Espera a que termine la generacion en curso."
                  : "Solo vuelve a correr ffmpeg: no gasta llamadas de IA ni de voz, y la version anterior se conserva."}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
