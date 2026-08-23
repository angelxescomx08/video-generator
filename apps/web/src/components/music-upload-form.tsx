"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  YOUTUBE_AUDIO_GENRE_LABELS_ES,
  YOUTUBE_AUDIO_GENRES,
  YOUTUBE_AUDIO_MOOD_LABELS_ES,
  YOUTUBE_AUDIO_MOODS,
} from "@video-generator/types";

const MAX_TAGS = 3;

/** Lee la duracion en el navegador: apps/web no debe ejecutar ffprobe (eso es trabajo del worker). */
function readAudioDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.addEventListener("loadedmetadata", () =>
      done(Number.isFinite(audio.duration) ? Math.round(audio.duration) : undefined),
    );
    audio.addEventListener("error", () => done(undefined));
    audio.src = url;
  });
}

export function MusicUploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [attribution, setAttribution] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [moods, setMoods] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPickFile(picked: File | null) {
    setFile(picked);
    setError(null);
    // Prellena el titulo con el nombre del archivo sin extension, para no escribirlo a mano.
    if (picked && !title) setTitle(picked.name.replace(/\.[^.]+$/, ""));
  }

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    if (list.includes(value)) setList(list.filter((v) => v !== value));
    else if (list.length < MAX_TAGS) setList([...list, value]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const duration = await readAudioDuration(file);

      const form = new FormData();
      form.append("file", file);
      form.append("title", title);
      if (artist) form.append("artist", artist);
      if (attribution) form.append("attribution", attribution);
      if (duration) form.append("durationSeconds", String(duration));
      for (const g of genres) form.append("genres", g);
      for (const m of moods) form.append("moods", m);

      const response = await fetch("/api/music", { method: "POST", body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "No se pudo subir la cancion");
      }

      setFile(null);
      setTitle("");
      setArtist("");
      setAttribution("");
      setGenres([]);
      setMoods([]);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Subir una cancion</h2>

      <div className="space-y-2">
        <Label htmlFor="music-file">Archivo de audio</Label>
        <Input
          id="music-file"
          ref={fileInput}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          required
        />
        <p className="text-xs text-muted-foreground">
          mp3, wav, m4a, aac, ogg, opus o flac. Maximo 30 MB. Asegurate de tener derecho a usarla en un
          video monetizado.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="music-title">Titulo</Label>
          <Input id="music-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="music-artist">Artista (opcional)</Label>
          <Input id="music-artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="music-attribution">Credito / licencia (opcional)</Label>
        <Input
          id="music-attribution"
          value={attribution}
          onChange={(e) => setAttribution(e.target.value)}
          placeholder="Ej. Music by Autor (link) — CC BY 4.0"
        />
        <p className="text-xs text-muted-foreground">
          Si la licencia pide credito, guardalo aqui para tenerlo a mano al publicar.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Genero <span className="text-xs font-normal text-muted-foreground">(hasta {MAX_TAGS})</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {YOUTUBE_AUDIO_GENRES.map((g) => {
            const active = genres.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggle(genres, setGenres, g)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-secondary"
                }`}
              >
                {YOUTUBE_AUDIO_GENRE_LABELS_ES[g]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Estado de animo <span className="text-xs font-normal text-muted-foreground">(hasta {MAX_TAGS})</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {YOUTUBE_AUDIO_MOODS.map((m) => {
            const active = moods.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggle(moods, setMoods, m)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-secondary"
                }`}
              >
                {YOUTUBE_AUDIO_MOOD_LABELS_ES[m]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Se usa el mismo vocabulario que la Biblioteca de audio de YouTube, para poder cruzar tus
          canciones con lo que sugiere la IA para cada video.
        </p>
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting || !file || !title}>
        {submitting ? "Subiendo..." : "Subir cancion"}
      </Button>
    </form>
  );
}
