"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function VideoForm({ themes }: { themes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [themeId, setThemeId] = useState(themes[0]?.id ?? "");
  const [format, setFormat] = useState<"long" | "short">("short");
  const [topic, setTopic] = useState("");
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(90);
  const idea = topic.trim();
  const maxDuration = format === "short" ? 180 : 1800;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId,
          format,
          topic: idea || undefined,
          captionsEnabled,
          targetDurationSeconds: Math.min(Math.max(durationSeconds, 10), maxDuration),
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Error al crear el video");
      const video = await response.json();
      router.push(`/videos/${video.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="theme">Tema</Label>
        <Select id="theme" value={themeId} onChange={(e) => setThemeId(e.target.value)} required>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="format">Formato</Label>
        <Select id="format" value={format} onChange={(e) => setFormat(e.target.value as "long" | "short")}>
          <option value="short">Short</option>
          <option value="long">Video largo</option>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="duration">Duracion objetivo (segundos)</Label>
        <Input
          id="duration"
          type="number"
          min={10}
          max={maxDuration}
          step={5}
          value={durationSeconds}
          onChange={(e) => setDurationSeconds(Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          {format === "short"
            ? "Un Short puede durar hasta 180s (3 min). Aprovecha el tiempo para contar la historia completa."
            : "Recomendado 180-600s para desarrollar bien el tema."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="idea">Idea del video</Label>
        <Textarea
          id="idea"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          required
          rows={6}
          className="min-h-[140px] resize-y"
          placeholder="Describe la idea del video. Puedes pegar el tema, notas, texto relacionado, un guion base, referencias... La IA generara el guion a partir de esto."
        />
        <p className="text-xs text-muted-foreground">
          Mientras mas contexto des, mejor sera el guion generado.
        </p>
      </div>

      <div className="flex items-start gap-2">
        <input
          id="captions"
          type="checkbox"
          checked={captionsEnabled}
          onChange={(e) => setCaptionsEnabled(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-border"
        />
        <div className="space-y-1">
          <Label htmlFor="captions">Subtitulos</Label>
          <p className="text-xs text-muted-foreground">
            Desactivados por defecto. Actívalos para quemar los subtitulos en el video.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting || !themeId || !idea}>
        {submitting ? "Creando..." : "Generar video"}
      </Button>
    </form>
  );
}
