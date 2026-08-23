"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StockClipRef } from "@video-generator/types";

interface SceneClip {
  sceneIndex: number;
  clip: StockClipRef;
  localPath: string;
}

/** Proveedores cuyos terminos EXIGEN el credito (espeja licensing.ts en stock-providers). */
const ATTRIBUTION_REQUIRED = new Set(["pexels"]);

/**
 * Muestra los creditos del material de stock usado en el video, listos para copiar a la descripcion
 * de YouTube. No es decorativo: los terminos de la API de Pexels exigen acreditar la fuente y al
 * autor, asi que sin esto un video con clips de Pexels se publica fuera de licencia.
 */
export function AttributionPanel({ sceneClips }: { sceneClips: SceneClip[] | null }) {
  const [copied, setCopied] = useState(false);

  if (!sceneClips || sceneClips.length === 0) return null;

  // Un mismo clip puede repetirse en varias escenas; el credito se pone una sola vez.
  const credits = [...new Map(sceneClips.map((sc) => [sc.clip.attribution ?? sc.clip.id, sc.clip])).values()].filter(
    (clip) => clip.attribution,
  );
  if (credits.length === 0) return null;

  const providers = [...new Set(credits.map((c) => c.provider))];
  const required = providers.filter((p) => ATTRIBUTION_REQUIRED.has(p));
  const creditText = credits.map((c) => c.attribution).join("\n");

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(creditText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Creditos del material de stock</h3>
        <Button type="button" size="sm" variant="outline" onClick={copyAll}>
          {copied ? "Copiado" : "Copiar creditos"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        {providers.map((p) => (
          <Badge key={p} variant={ATTRIBUTION_REQUIRED.has(p) ? "default" : "secondary"}>
            {p}
            {ATTRIBUTION_REQUIRED.has(p) ? " · credito obligatorio" : " · credito opcional"}
          </Badge>
        ))}
      </div>

      {required.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Pegalos en la descripcion del video.</span> Los
          terminos de la API de {required.join(", ")} exigen acreditar la fuente y al autor con un enlace
          visible. El uso comercial (monetizacion) esta permitido siempre que ese credito este presente.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ninguna de las fuentes usadas exige credito obligatorio; incluirlo es opcional.
        </p>
      )}

      <ul className="space-y-1 rounded-md border border-border p-3">
        {credits.map((clip, i) => (
          <li key={`${clip.provider}-${clip.id}-${i}`} className="text-xs text-muted-foreground">
            {clip.previewUrl ? (
              <a
                href={clip.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {clip.attribution}
              </a>
            ) : (
              clip.attribution
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
