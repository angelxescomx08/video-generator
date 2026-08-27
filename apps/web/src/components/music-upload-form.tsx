"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Music, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { MusicTrack } from "@video-generator/db";
import {
  YOUTUBE_AUDIO_GENRE_LABELS_ES,
  YOUTUBE_AUDIO_GENRES,
  YOUTUBE_AUDIO_MOOD_LABELS_ES,
  YOUTUBE_AUDIO_MOODS,
} from "@video-generator/types";

const MAX_TAGS = 3;
const MAX_SIZE_BYTES = 30 * 1024 * 1024;

/**
 * Fases de la subida. Se separan porque el usuario ve tiempos muy distintos: leer la duracion es
 * instantaneo, subir los bytes tiene porcentaje real, y lo que pasa despues (escribir el archivo en
 * disco + insertar la fila) no reporta avance pero puede tardar en un archivo grande.
 */
type Phase = "idle" | "reading" | "uploading" | "processing" | "done";

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

/**
 * Sube el formulario con XMLHttpRequest en vez de `fetch`.
 *
 * Es la unica forma de tener progreso de subida en el navegador: `fetch` no expone eventos de upload
 * (los ReadableStream de request no tienen soporte suficiente), asi que con fetch lo maximo que se
 * puede mostrar es un "Subiendo..." fijo — que es justo lo que se sentia como "no hay cargador".
 */
function uploadTrack(
  form: FormData,
  handlers: {
    onProgress: (loaded: number, total: number) => void;
    onUploaded: () => void;
    registerXhr: (xhr: XMLHttpRequest) => void;
  },
): Promise<MusicTrack> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    handlers.registerXhr(xhr);
    xhr.open("POST", "/api/music");

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) handlers.onProgress(event.loaded, event.total);
    });
    // Los bytes ya salieron; lo que falta es el trabajo del servidor, que no reporta avance.
    xhr.upload.addEventListener("load", () => handlers.onUploaded());

    xhr.addEventListener("load", () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as MusicTrack);
        return;
      }
      const error = (body as { error?: unknown } | null)?.error;
      reject(new Error(typeof error === "string" ? error : `No se pudo subir la cancion (HTTP ${xhr.status})`));
    });
    xhr.addEventListener("error", () => reject(new Error("Se corto la conexion con el servidor")));
    xhr.addEventListener("abort", () => reject(new DOMException("cancelado", "AbortError")));

    xhr.send(form);
  });
}

export function MusicUploadForm({
  compact = false,
  onUploaded,
}: {
  /** Version reducida, para incrustarla dentro de otro panel (p.ej. el detalle de un video). */
  compact?: boolean;
  /** Se llama con la cancion recien creada; si no se pasa, solo se refresca la pagina. */
  onUploaded?: (track: MusicTrack) => void;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [attribution, setAttribution] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [moods, setMoods] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [sentBytes, setSentBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastUploaded, setLastUploaded] = useState<string | null>(null);

  const busy = phase === "reading" || phase === "uploading" || phase === "processing";
  const percent = file && file.size > 0 ? Math.round((sentBytes / file.size) * 100) : 0;

  // Si el componente se desmonta a mitad de la subida (p.ej. se cierra el panel), se corta la
  // peticion en vez de dejarla escribiendo contra un componente que ya no existe.
  useEffect(() => () => xhrRef.current?.abort(), []);

  function onPickFile(picked: File | null) {
    setError(null);
    setLastUploaded(null);
    if (picked && picked.size > MAX_SIZE_BYTES) {
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setError(`"${picked.name}" pesa ${formatMb(picked.size)} y el limite son ${formatMb(MAX_SIZE_BYTES)}.`);
      return;
    }
    setFile(picked);
    // Prellena el titulo con el nombre del archivo sin extension, para no escribirlo a mano.
    if (picked && !title) setTitle(picked.name.replace(/\.[^.]+$/, ""));
  }

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    if (list.includes(value)) setList(list.filter((v) => v !== value));
    else if (list.length < MAX_TAGS) setList([...list, value]);
  }

  function resetForm() {
    setFile(null);
    setTitle("");
    setArtist("");
    setAttribution("");
    setGenres([]);
    setMoods([]);
    setSentBytes(0);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setError(null);
    setLastUploaded(null);
    setSentBytes(0);
    setPhase("reading");

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

      setPhase("uploading");
      const track = await uploadTrack(form, {
        onProgress: (loaded) => setSentBytes(loaded),
        onUploaded: () => setPhase("processing"),
        registerXhr: (xhr) => {
          xhrRef.current = xhr;
        },
      });

      setPhase("done");
      setLastUploaded(track?.title ?? title);
      resetForm();
      onUploaded?.(track);
      router.refresh();
    } catch (err) {
      setSentBytes(0);
      setPhase("idle");
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      xhrRef.current = null;
    }
  }

  function onCancel() {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setPhase("idle");
    setSentBytes(0);
  }

  const statusText =
    phase === "reading"
      ? "Leyendo el archivo..."
      : phase === "uploading"
        ? `Subiendo ${formatMb(sentBytes)} de ${formatMb(file?.size ?? 0)}`
        : phase === "processing"
          ? "Guardando en la biblioteca..."
          : null;

  return (
    <form
      onSubmit={onSubmit}
      className={compact ? "space-y-3" : "space-y-4 rounded-lg border border-border bg-card p-4"}
    >
      {!compact && <h2 className="font-semibold">Subir una cancion</h2>}

      <div className="space-y-2">
        <Label htmlFor="music-file">Archivo de audio</Label>
        <Input
          id="music-file"
          ref={fileInput}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac"
          disabled={busy}
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          required
        />
        {file ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Music className="h-3 w-3 shrink-0" />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 tabular-nums">· {formatMb(file.size)}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            mp3, wav, m4a, aac, ogg, opus o flac. Maximo {formatMb(MAX_SIZE_BYTES)}.
            {!compact && " Asegurate de tener derecho a usarla en un video monetizado."}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="music-title">Titulo</Label>
          <Input
            id="music-title"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="music-artist">Artista (opcional)</Label>
          <Input id="music-artist" value={artist} disabled={busy} onChange={(e) => setArtist(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="music-attribution">Credito / licencia (opcional)</Label>
        <Input
          id="music-attribution"
          value={attribution}
          disabled={busy}
          onChange={(e) => setAttribution(e.target.value)}
          placeholder="Ej. Music by Autor (link) — CC BY 4.0"
        />
        {!compact && (
          <p className="text-xs text-muted-foreground">
            Si la licencia pide credito, guardalo aqui para tenerlo a mano al publicar.
          </p>
        )}
      </div>

      <fieldset className="space-y-2" disabled={busy}>
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
                disabled={busy}
                onClick={() => toggle(genres, setGenres, g)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
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

      <fieldset className="space-y-2" disabled={busy}>
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
                disabled={busy}
                onClick={() => toggle(moods, setMoods, m)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
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
        {!compact && (
          <p className="text-xs text-muted-foreground">
            Se usa el mismo vocabulario que la Biblioteca de audio de YouTube, para poder cruzar tus
            canciones con lo que sugiere la IA para cada video.
          </p>
        )}
      </fieldset>

      {/* Cargador: barra con porcentaje real mientras viajan los bytes, e indeterminada mientras el
          servidor guarda. Antes solo cambiaba el texto del boton y parecia que no pasaba nada. */}
      {busy && (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              {statusText}
            </span>
            <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
              {phase === "uploading" ? `${percent}%` : ""}
            </span>
          </div>
          <Progress value={percent} indeterminate={phase !== "uploading"} />
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
          >
            <X className="h-3 w-3" /> Cancelar subida
          </button>
        </div>
      )}

      {phase === "done" && lastUploaded && (
        <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 p-2 text-sm">
          <Check className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <span className="font-medium">{lastUploaded}</span> quedo en tu biblioteca.
          </span>
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={busy || !file || !title}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        {busy ? "Subiendo..." : "Subir cancion"}
      </Button>
    </form>
  );
}
