"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Limites y cortes reales de YouTube (verificados 2026-08-23).
 *
 * Lo importante no es el limite duro sino el CORTE VISIBLE: casi nadie toca "…mas", asi que lo que
 * no entra en esos primeros caracteres practicamente no existe para el espectador.
 */
const LIMITS = {
  titleMax: 100,
  /** Lo que se alcanza a leer del titulo en la vista previa del feed. */
  titleVisible: 50,
  descriptionMax: 5000,
  /** Antes de "…mas" se ven ~100-160 chars segun el ancho de pantalla; 125 es el valor prudente. */
  descriptionVisible: 125,
  tagsMax: 500,
  /** Los primeros 3 hashtags de la descripcion salen como enlaces ARRIBA del titulo. */
  promotedHashtags: 3,
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copiado" : label}
    </Button>
  );
}

/** Cuenta caracteres contra el limite y el corte visible, con color segun que tan cerca esta. */
function CharCount({ value, max, visible }: { value: string; max: number; visible?: number }) {
  const length = value.length;
  const overLimit = length > max;
  const overVisible = visible !== undefined && length > visible;

  return (
    <span className="text-xs tabular-nums">
      <span className={overLimit ? "font-medium text-destructive" : "text-muted-foreground"}>
        {length}/{max}
      </span>
      {visible !== undefined && (
        <span className="text-muted-foreground">
          {" · "}
          {overVisible ? `se corta a los ${visible}` : `entra completo (visible: ${visible})`}
        </span>
      )}
    </span>
  );
}

export function YoutubeMetadataPanel({
  title,
  description,
  tags,
  format,
}: {
  title: string | null;
  description: string | null;
  tags: string[] | null;
  format: "long" | "short";
}) {
  if (!title && !description && (!tags || tags.length === 0)) return null;

  const safeTitle = title ?? "";
  const safeDescription = description ?? "";
  const safeTags = tags ?? [];

  const hashtags = safeDescription.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const promoted = hashtags.slice(0, LIMITS.promotedHashtags);
  const descriptionVisible = safeDescription.slice(0, LIMITS.descriptionVisible);
  const descriptionHidden = safeDescription.slice(LIMITS.descriptionVisible);
  const tagsLength = safeTags.join(",").length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Metadata para YouTube</h3>
        <p className="text-sm text-muted-foreground">
          Titulo y descripcion son campos SEPARADOS. En el reproductor de{" "}
          {format === "short" ? "Shorts" : "YouTube"} se ven juntos encima del video, pero se suben por
          separado.
        </p>
      </div>

      {/* Simulacion de lo que el espectador ve sin tocar nada */}
      {format === "short" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Lo que se ve en el feed</p>
          <div className="space-y-1 rounded-md border border-border bg-black/90 p-3 text-white">
            {promoted.length > 0 && (
              <p className="text-xs text-sky-300">{promoted.join(" ")}</p>
            )}
            <p className="text-sm font-semibold leading-snug">
              {safeTitle.slice(0, LIMITS.titleVisible)}
              {safeTitle.length > LIMITS.titleVisible && (
                <span className="font-normal text-white/40">{safeTitle.slice(LIMITS.titleVisible)}</span>
              )}
            </p>
            <p className="text-xs leading-snug text-white/70">
              {descriptionVisible}
              {descriptionHidden && <span className="text-white/30"> …mas</span>}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            En gris, lo que probablemente no se lea. Los primeros {LIMITS.promotedHashtags} hashtags de la
            descripcion salen como enlaces arriba del titulo, sin gastar caracteres del titulo.
          </p>
        </div>
      )}

      {/* Titulo */}
      <div className="space-y-1.5 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Titulo</span>
            <CharCount value={safeTitle} max={LIMITS.titleMax} visible={LIMITS.titleVisible} />
          </div>
          {safeTitle && <CopyButton text={safeTitle} label="Copiar titulo" />}
        </div>
        <p className="text-sm">{safeTitle || <span className="text-muted-foreground">Sin titulo</span>}</p>
      </div>

      {/* Descripcion */}
      <div className="space-y-1.5 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Descripcion</span>
            <CharCount
              value={safeDescription}
              max={LIMITS.descriptionMax}
              visible={LIMITS.descriptionVisible}
            />
          </div>
          {safeDescription && <CopyButton text={safeDescription} label="Copiar descripcion" />}
        </div>
        <p className="whitespace-pre-wrap text-sm">
          {descriptionVisible}
          {descriptionHidden && <span className="text-muted-foreground">{descriptionHidden}</span>}
        </p>
        {hashtags.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {hashtags.length} hashtag{hashtags.length === 1 ? "" : "s"}
            {hashtags.length > 15 && (
              <span className="text-destructive"> — YouTube permite maximo 15 por video</span>
            )}
          </p>
        )}
      </div>

      {/* Tags */}
      {safeTags.length > 0 && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Tags</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {safeTags.length} tags · {tagsLength}/{LIMITS.tagsMax} caracteres
              </span>
            </div>
            <CopyButton text={safeTags.join(", ")} label="Copiar tags" />
          </div>
          <div className="flex flex-wrap gap-1">
            {safeTags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
