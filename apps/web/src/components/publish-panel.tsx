"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export interface ExistingPublication {
  platformAccountId: string;
  externalVideoId: string;
  externalUrl: string | null;
}

export function PublishPanel({
  videoId,
  accounts,
  published,
}: {
  videoId: string;
  accounts: { id: string; label: string }[];
  /**
   * Publicaciones que YA existen, leidas del servidor. Es la pieza clave: antes el "ya publiqué" vivia
   * solo en estado de React, asi que un simple refresh reactivaba el boton y se podia volver a subir el
   * mismo video sin ningun aviso.
   */
  published: ExistingPublication[];
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay cuentas conectadas. Conecta YouTube o Facebook en Configuracion / Cuentas.
      </p>
    );
  }

  const alreadyHere = published.find((p) => p.platformAccountId === accountId);

  async function onPublish() {
    setSubmitting(true);
    setResult(null);
    setConfirming(false);
    try {
      const response = await fetch(`/api/videos/${videoId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformAccountId: accountId }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setResult({
          kind: "ok",
          text: "Subida encolada. Tarda unos minutos; el estado de arriba se actualiza cuando termina.",
        });
        router.refresh();
      } else {
        // Antes los fallos se ignoraban en silencio (`if (response.ok)` sin rama else), asi que un
        // error se veia igual que un exito y la reaccion natural era volver a darle al boton.
        setResult({ kind: "error", text: body.error?.toString() ?? `Fallo al publicar (HTTP ${response.status}).` });
      }
    } catch (err) {
      setResult({ kind: "error", text: `No se pudo contactar al servidor: ${(err as Error).message}` });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {published.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium">Este video ya esta publicado</p>
          {published.map((p) => (
            <a
              key={p.externalVideoId}
              href={p.externalUrl ?? `https://www.youtube.com/watch?v=${p.externalVideoId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <code>{p.externalVideoId}</code>
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      )}

      <div className="flex max-w-md items-end gap-3">
        <div className="flex-1 space-y-2">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        {confirming ? (
          <div className="flex gap-2">
            <Button onClick={onPublish} disabled={submitting}>
              {submitting ? "Enviando..." : "Si, publicar"}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={submitting}>
              Cancelar
            </Button>
          </div>
        ) : (
          // Se confirma porque publicar es irreversible desde aqui: el video queda visible en la
          // plataforma y borrarlo hay que hacerlo a mano en YouTube Studio.
          <Button onClick={() => setConfirming(true)} disabled={submitting}>
            <Upload className="mr-2 h-4 w-4" />
            {alreadyHere ? "Publicar otra vez" : "Publicar"}
          </Button>
        )}
      </div>

      {confirming && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {alreadyHere
              ? "Ya existe una publicacion de este video en esa cuenta. Si continuas quedaran DOS videos en el canal y tendras que borrar uno a mano."
              : "Se subira a la plataforma como publico, marcado como no apto para ninos y declarado como contenido generado con IA. Para quitarlo despues hay que borrarlo desde YouTube Studio."}
          </span>
        </p>
      )}

      {result && (
        <p className={result.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {result.text}
        </p>
      )}
    </div>
  );
}
