"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MusicUploadForm } from "@/components/music-upload-form";
import { notifyVideoChanged } from "@/lib/video-refresh";
import type { MusicTrack } from "@video-generator/db";
import {
  BACKGROUND_MUSIC_LEVELS,
  YOUTUBE_AUDIO_GENRE_LABELS_ES,
  YOUTUBE_AUDIO_MOOD_LABELS_ES,
  type YoutubeAudioGenre,
  type YoutubeAudioMood,
  type YoutubeAudioSuggestion,
} from "@video-generator/types";

const NO_MUSIC = "__none__";

/** Generos y animos en español, como se leen en la etiqueta de una pista o en la sugerencia. */
function toSpanish(genres: string[], moods: string[]): string[] {
  return [
    ...genres.map((g) => YOUTUBE_AUDIO_GENRE_LABELS_ES[g as YoutubeAudioGenre] ?? g),
    ...moods.map((m) => YOUTUBE_AUDIO_MOOD_LABELS_ES[m as YoutubeAudioMood] ?? m),
  ];
}

/**
 * Etiquetas de una pista para mostrarlas DENTRO del `<option>`.
 *
 * Sin esto el desplegable solo decia titulo y artista, asi que no habia forma de saber cual encajaba
 * con el video sin abrir la biblioteca: el ★ marcaba la coincidencia pero no decia en que. Un
 * `<option>` no admite markup, por eso van como texto plano separadas por puntos.
 */
function trackTagsLabel(track: MusicTrack): string {
  const labels = toSpanish(track.genres, track.moods);
  return labels.length > 0 ? labels.join(", ") : "sin etiquetas";
}

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
  const [uploading, setUploading] = useState(false);
  const [onlySuggested, setOnlySuggested] = useState(false);
  /**
   * Canciones subidas desde aqui mismo. `tracks` viene del servidor y solo se actualiza cuando
   * termina el `router.refresh()`; guardarlas tambien en local hace que aparezcan seleccionadas en
   * el desplegable al instante, sin ese hueco en el que el Select se queda en blanco.
   */
  const [justUploaded, setJustUploaded] = useState<MusicTrack[]>([]);

  const allTracks = [
    ...justUploaded.filter((t) => !tracks.some((existing) => existing.id === t.id)),
    ...tracks,
  ];

  // Canciones cuyo genero o animo coincide con lo que la IA sugirio para este video: atajo util
  // cuando la biblioteca ya tiene muchas pistas.
  const suggestedIds = new Set(
    suggestion
      ? allTracks
          .filter(
            (t) =>
              t.genres.some((g) => suggestion.genres.includes(g as YoutubeAudioGenre)) ||
              t.moods.some((m) => suggestion.moods.includes(m as YoutubeAudioMood)),
          )
          .map((t) => t.id)
      : [],
  );

  /**
   * La seleccionada siempre se queda en la lista aunque no encaje con la sugerencia: si el filtro la
   * escondiera, el `<select>` se quedaria mostrando un valor que ya no existe entre sus opciones y
   * el usuario veria el desplegable en blanco sin haber cambiado nada.
   */
  const visibleTracks = onlySuggested
    ? allTracks.filter((t) => suggestedIds.has(t.id) || t.id === selected)
    : allTracks;

  const suggestionLabels = suggestion ? toSpanish(suggestion.genres, suggestion.moods) : [];

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
      // El re-render ya esta encolado: avisa a los paneles client-side (versiones, costos) para que
      // no se queden mostrando el estado anterior.
      notifyVideoChanged(videoId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  function onUploaded(track: MusicTrack) {
    setJustUploaded((prev) => [track, ...prev]);
    setSelected(track.id);
    setUploading(false);
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
        {/* Boton explicito de subida: antes solo habia un enlace a /music escondido en el texto de
            "no tienes canciones", asi que con la biblioteca ya poblada no habia forma de subir una
            nueva sin salir del video. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {allTracks.length === 0
              ? "Tu biblioteca esta vacia."
              : `${allTracks.length} ${allTracks.length === 1 ? "cancion" : "canciones"} en tu biblioteca.`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={allTracks.length === 0 ? "default" : "outline"}
              onClick={() => setUploading((v) => !v)}
            >
              {uploading ? (
                <>
                  <X className="mr-2 h-3.5 w-3.5" /> Cerrar
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Subir cancion
                </>
              )}
            </Button>
            <Link href="/music" className="text-xs text-muted-foreground underline hover:text-foreground">
              Ver biblioteca
            </Link>
          </div>
        </div>

        {uploading && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Upload className="h-3.5 w-3.5" /> Subir una cancion a la biblioteca
            </p>
            <MusicUploadForm compact onUploaded={onUploaded} />
            <p className="mt-3 text-xs text-muted-foreground">
              Al terminar queda seleccionada aqui; todavia hay que darle a &quot;Aplicar y crear
              version&quot; para ponersela al video.
            </p>
          </div>
        )}

        {allTracks.length === 0 ? (
          !uploading && (
            <p className="text-sm text-muted-foreground">
              Sube una cancion con el boton de arriba para poder ponersela a este video.
            </p>
          )
        ) : (
          <>
            <div className="space-y-2">
              {suggestionLabels.length > 0 && (
                <div className="rounded-md border border-border bg-muted/30 p-2.5">
                  <p className="text-xs text-muted-foreground">
                    La IA sugirio para este video:{" "}
                    <span className="font-medium text-foreground">{suggestionLabels.join(", ")}</span>
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={onlySuggested}
                      disabled={suggestedIds.size === 0}
                      onChange={(e) => setOnlySuggested(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border"
                    />
                    <span className={suggestedIds.size === 0 ? "text-muted-foreground" : ""}>
                      Ver solo las que encajan ({suggestedIds.size})
                    </span>
                  </label>
                  {suggestedIds.size === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ninguna cancion de tu biblioteca tiene ese genero o animo. Etiquetalas al subirlas
                      para poder filtrar aqui.
                    </p>
                  )}
                </div>
              )}

              <Label htmlFor="music-select">Cancion</Label>
              <Select id="music-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value={NO_MUSIC}>Sin musica (solo narracion)</option>
                {visibleTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {suggestedIds.has(t.id) ? "★ " : ""}
                    {t.title}
                    {t.artist ? ` — ${t.artist}` : ""}
                    {` · ${trackTagsLabel(t)}`}
                  </option>
                ))}
              </Select>
              {suggestedIds.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  ★ = coincide con la sugerencia. Despues del punto van el genero y el animo de cada
                  cancion, para compararlos con el de arriba.
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
                {submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
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
