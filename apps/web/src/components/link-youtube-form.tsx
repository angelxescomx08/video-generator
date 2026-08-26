"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { extractYoutubeVideoId } from "@video-generator/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Vincula el registro del video con el video real en YouTube. Es el paso que habilita el boton de
 * sincronizar: sin este vinculo la app no sabe a que video de YouTube preguntarle, y por eso el resto
 * de la pantalla aparece deshabilitado.
 *
 * Hace falta porque publicar desde la app no es el unico camino: un video subido a mano desde YouTube
 * Studio no deja rastro en la base, y aun asi se quieren sus estadisticas para el feedback loop.
 */
export function LinkYoutubeForm({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Se resuelve en vivo para que el usuario vea que se entendio de lo que pego ANTES de guardar —
  // pegar el enlace de otro video es un error facil de cometer y caro de detectar despues.
  const detectedId = extractYoutubeVideoId(value);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLinking(true);
    setError(null);
    try {
      const response = await fetch(`/api/videos/${videoId}/link-youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrlOrId: value }),
      });
      if (response.ok) {
        router.refresh();
      } else {
        const body = await response.json().catch(() => ({}));
        setError(body.error?.toString() ?? "No se pudo vincular.");
      }
    } finally {
      setLinking(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Vincula el video de YouTube para activar la sincronizacion</h2>
        <p className="text-xs text-muted-foreground">
          Este video no se publico desde la app, asi que todavia no sabe cual de tus videos de YouTube es.
          Pega su enlace y a partir de ahi podras traer las analiticas con un boton.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="youtube-url">Enlace o ID del video</Label>
        <Input
          id="youtube-url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://www.youtube.com/shorts/dQw4w9WgXcQ"
        />
        {value.trim() && (
          <p className="text-xs">
            {detectedId ? (
              <span className="text-muted-foreground">
                ID detectado: <code className="font-medium text-foreground">{detectedId}</code>
              </span>
            ) : (
              <span className="text-destructive">
                No se reconoce un ID de video aqui. Sirve la URL completa (watch, shorts o youtu.be) o el
                ID de 11 caracteres.
              </span>
            )}
          </p>
        )}
      </div>

      <Button type="submit" disabled={linking || !detectedId}>
        <Link2 className="mr-2 h-4 w-4" />
        {linking ? "Vinculando..." : "Vincular y traer analiticas"}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <p className="text-[11px] text-muted-foreground">
        Al vincular se encola de inmediato la primera sincronizacion: se traen las metricas y la fecha real
        de publicacion desde YouTube. Si el ID no corresponde a un video de tu canal, el vinculo se marca
        como fallido en vez de quedarse reintentando.
      </p>
    </form>
  );
}
