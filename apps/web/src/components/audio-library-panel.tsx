"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  YOUTUBE_AUDIO_GENRE_LABELS_ES,
  YOUTUBE_AUDIO_MOOD_LABELS_ES,
  type YoutubeAudioGenre,
  type YoutubeAudioMood,
  type YoutubeAudioSuggestion,
} from "@video-generator/types";

const AUDIO_LIBRARY_URL = "https://studio.youtube.com/channel/UC/music";

/**
 * Sugerencias para buscar musica en la Biblioteca de audio de YouTube Studio.
 *
 * Los valores vienen acotados a los filtros reales de YouTube (ver youtube-audio-library.ts), asi
 * que se pueden copiar tal cual en la barra de filtros. Se muestran el nombre en español y, en
 * chico, el termino en ingles: la UI de YouTube puede estar en cualquier idioma y el filtro se
 * escribe con la etiqueta original.
 */
export function AudioLibraryPanel({ suggestion }: { suggestion: YoutubeAudioSuggestion | null }) {
  const [copied, setCopied] = useState(false);

  if (!suggestion) return null;
  const { genres, moods } = suggestion;
  if (genres.length === 0 && moods.length === 0) return null;

  const copyText = [
    genres.length > 0 ? `Generos: ${genres.join(", ")}` : null,
    moods.length > 0 ? `Estados de animo: ${moods.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Musica sugerida (Biblioteca de audio de YouTube)</h3>
        <Button type="button" size="sm" variant="outline" onClick={copyAll}>
          {copied ? "Copiado" : "Copiar filtros"}
        </Button>
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        {genres.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Genero</p>
            <div className="flex flex-wrap gap-1.5">
              {genres.map((g) => (
                <Badge key={g} variant="default">
                  {YOUTUBE_AUDIO_GENRE_LABELS_ES[g as YoutubeAudioGenre] ?? g}
                  <span className="ml-1.5 opacity-70">({g})</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {moods.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Estado de animo</p>
            <div className="flex flex-wrap gap-1.5">
              {moods.map((m) => (
                <Badge key={m} variant="secondary">
                  {YOUTUBE_AUDIO_MOOD_LABELS_ES[m as YoutubeAudioMood] ?? m}
                  <span className="ml-1.5 opacity-70">({m})</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Usa estos valores en los filtros <span className="font-medium text-foreground">Genero</span> y{" "}
          <span className="font-medium text-foreground">Estado de animo</span> de la{" "}
          <a
            href={AUDIO_LIBRARY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Biblioteca de audio de YouTube Studio
          </a>
          . Toda su musica se puede usar en videos monetizados; revisa si la pista pide atribucion
          (el filtro de YouTube lo indica).
        </p>
      </div>
    </div>
  );
}
