"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  DURATION_LIMITS,
  clampDurationToLimits,
  diffText,
  resolveDurationBand,
  sanitizePromptText,
  type SanitizedPrompt,
} from "@video-generator/types";

export function VideoForm({ themes }: { themes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [themeId, setThemeId] = useState(themes[0]?.id ?? "");
  const [format, setFormat] = useState<"long" | "short">("short");
  const [topic, setTopic] = useState("");
  // Mientras esto sea null la idea todavia no paso por el limpiador y no se puede generar.
  const [cleaned, setCleaned] = useState<SanitizedPrompt | null>(null);
  // Texto tal cual estaba en el textarea justo antes de limpiar, para poder mostrar el diff.
  const [preClean, setPreClean] = useState("");
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [durationSeconds, setDurationSeconds] = useState<number>(DURATION_LIMITS.short.default);
  const idea = topic.trim();
  const limits = DURATION_LIMITS[format];
  // Lo que se escribe aqui es el TECHO; el piso lo deriva el formato. Se muestra la banda completa
  // para que quede claro que el video puede salir mas corto sin que eso sea un fallo.
  const band = resolveDurationBand(format, durationSeconds);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onTopicChange(value: string) {
    setTopic(value);
    // Cualquier edicion posterior invalida la limpieza: hay que volver a pasarla.
    setCleaned(null);
  }

  function onClean() {
    const result = sanitizePromptText(topic);
    setPreClean(topic);
    setTopic(result.text); // el usuario ve el cambio en el propio textarea
    setCleaned(result);
  }

  const diff = useMemo(
    () => (cleaned?.changed ? diffText(preClean, cleaned.text) : []),
    [cleaned, preClean],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cleaned) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId,
          format,
          topic: cleaned.text || undefined,
          captionsEnabled,
          targetDurationSeconds: clampDurationToLimits(format, durationSeconds),
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
        <Select
          id="format"
          value={format}
          onChange={(e) => {
            const next = e.target.value as "long" | "short";
            setFormat(next);
            // Los limites dependen del formato: sin esto, cambiar a "video largo" con 20s puesto
            // dejaria el input y la banda mostrando cosas distintas hasta que el usuario lo tocara.
            setDurationSeconds((seconds) => clampDurationToLimits(next, seconds));
          }}
        >
          <option value="short">Short</option>
          <option value="long">Video largo</option>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="duration">Duracion maxima (segundos)</Label>
        <Input
          id="duration"
          type="number"
          min={limits.min}
          max={limits.max}
          step={5}
          value={durationSeconds}
          onChange={(e) => setDurationSeconds(Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Es un techo, no un tiempo exacto: el video saldra{" "}
          <span className="font-medium text-foreground">
            entre {band.minSeconds}s y {band.maxSeconds}s
          </span>
          . Puede desbordar el techo por un par de segundos porque la duracion se estima a partir de
          las palabras del guion, y el ritmo real de la voz varia.
        </p>
        <p className="text-xs text-muted-foreground">
          {format === "short"
            ? `Permitido ${limits.min}-${limits.max}s. YouTube admite Shorts de hasta 3 minutos, pero las referencias de retencion ubican el punto dulce en 30-45s.`
            : `Permitido ${limits.min}-${limits.max}s. Recomendado 180-600s para desarrollar bien el tema.`}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="idea">Idea del video</Label>
        <Textarea
          id="idea"
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
          required
          rows={6}
          className="min-h-[140px] resize-y"
          placeholder="Describe la idea del video. Puedes pegar el tema, notas, texto relacionado, un guion base, referencias... La IA generara el guion a partir de esto."
        />
        <p className="text-xs text-muted-foreground">
          Mientras mas contexto des, mejor sera el guion generado.
        </p>

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onClean} disabled={!idea || !!cleaned}>
            {cleaned ? "Contenido limpio" : "Limpiar contenido"}
          </Button>
          {!cleaned && idea && (
            <span className="text-xs text-muted-foreground">
              Paso obligatorio antes de generar: quita emojis y caracteres que solo gastan tokens.
            </span>
          )}
        </div>

        {cleaned && (
          <div className="rounded-lg border border-border bg-card p-3 text-xs">
            {cleaned.changed ? (
              <>
                <p className="font-medium text-foreground">Texto limpiado y actualizado arriba.</p>
                <p className="mt-2 mb-1 text-muted-foreground">
                  Que cambio (
                  <span className="text-red-600 line-through dark:text-red-400">quitado</span> /{" "}
                  <span className="text-emerald-600 dark:text-emerald-400">agregado</span>):
                </p>
                <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 leading-relaxed">
                  {diff.map((seg, idx) => {
                    if (seg.type === "equal") return <span key={idx}>{seg.value}</span>;
                    if (seg.type === "removed")
                      return (
                        <span
                          key={idx}
                          className="rounded-sm bg-red-500/10 text-red-600 line-through dark:text-red-400"
                        >
                          {seg.value}
                        </span>
                      );
                    return (
                      <span
                        key={idx}
                        className="rounded-sm bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      >
                        {seg.value}
                      </span>
                    );
                  })}
                </div>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  <li>
                    Caracteres: {cleaned.originalChars} → {cleaned.cleanedChars} ({cleaned.removedChars}{" "}
                    menos)
                  </li>
                  <li>
                    Tokens de entrada estimados: {cleaned.estimatedTokensBefore} →{" "}
                    {cleaned.estimatedTokensAfter} ({cleaned.estimatedTokensSaved} ahorrados)
                  </li>
                  {cleaned.emojisRemoved > 0 && <li>Emojis quitados: {cleaned.emojisRemoved}</li>}
                  {cleaned.invisiblesRemoved > 0 && (
                    <li>Caracteres invisibles quitados: {cleaned.invisiblesRemoved}</li>
                  )}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">
                El texto ya estaba limpio, no habia nada que quitar (~{cleaned.estimatedTokensAfter}{" "}
                tokens de entrada).
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Subtitulos</h3>

        <div className="flex items-start gap-2">
          <input
            id="captions"
            type="checkbox"
            checked={captionsEnabled}
            onChange={(e) => setCaptionsEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-border"
          />
          <div className="space-y-1">
            <Label htmlFor="captions">Quemar subtitulos en el video</Label>
            <p className="text-xs text-muted-foreground">
              Transcripcion de la narracion, sincronizada palabra por palabra con la voz.
            </p>
          </div>
        </div>

        {captionsEnabled && (
          <ul className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Estilo:</span> texto blanco en negrita con
              contorno negro grueso, para que se lea sobre cualquier fondo (claro u oscuro).
            </li>
            <li>
              <span className="font-medium text-foreground">Resalte:</span> la palabra que se esta
              pronunciando se enciende en amarillo.
            </li>
            <li>
              <span className="font-medium text-foreground">Posicion:</span>{" "}
              {format === "short"
                ? "por encima de los 450px inferiores que YouTube tapa con el titulo, el canal y el boton de suscribirse, y fuera de la columna de botones de la derecha."
                : "cerca del borde inferior, libre de la barra de controles del reproductor."}
            </li>
            <li>
              <span className="font-medium text-foreground">Ritmo:</span>{" "}
              {format === "short" ? "bloques de 2 a 4 palabras" : "bloques de hasta 8 palabras"}, que
              cambian al ritmo del habla.
            </li>
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <Button type="submit" disabled={submitting || !themeId || !idea || !cleaned}>
          {submitting ? "Creando..." : "Generar video"}
        </Button>
        {idea && !cleaned && (
          <p className="text-xs text-muted-foreground">
            Limpia el contenido de la idea para habilitar la generacion.
          </p>
        )}
      </div>
    </form>
  );
}
