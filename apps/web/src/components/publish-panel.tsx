"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { notifyVideoChanged } from "@/lib/video-refresh";

export interface ExistingPublication {
  platformAccountId: string;
  externalVideoId: string;
  externalUrl: string | null;
}

export function PublishPanel({
  videoId,
  accounts,
  published,
  videoStatus,
}: {
  videoId: string;
  accounts: { id: string; label: string }[];
  /**
   * Publicaciones que YA existen, leidas del servidor. Es la pieza clave: antes el "ya publiqué" vivia
   * solo en estado de React, asi que un simple refresh reactivaba el boton y se podia volver a subir el
   * mismo video sin ningun aviso.
   */
  published: ExistingPublication[];
  /** Estado real del video. Con `publishing` hay una subida en curso y el boton no debe aceptar clicks. */
  videoStatus: string;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /**
   * Se encolo la subida en esta pestana. Se mantiene aparte de `submitting` porque `submitting` se
   * apaga en cuanto responde la API: ahi el boton volvia a habilitarse aunque la subida real apenas
   * estuviera empezando, y cada click extra encolaba otro job — el camino directo a tener el mismo
   * video dos veces en el canal.
   */
  const [enqueued, setEnqueued] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  /** El servidor rechazo por duplicado; se ofrece forzar en vez de dejar el boton muerto. */
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);

  /**
   * Suelta el bloqueo solo cuando el intento de publicacion termino de verdad. No se puede soltar en
   * cualquier cambio de estado: justo despues de encolar, el prop del servidor todavia dice "ready"
   * durante un instante y eso reactivaria el boton en la peor ventana posible.
   */
  useEffect(() => {
    if (videoStatus === "published" || videoStatus === "failed") setEnqueued(false);
  }, [videoStatus]);

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay cuentas conectadas. Conecta YouTube o Facebook en Configuracion / Cuentas.
      </p>
    );
  }

  const alreadyHere = published.find((p) => p.platformAccountId === accountId);
  const publishing = videoStatus === "publishing";
  // Mientras se genera o se re-renderiza no hay nada estable que subir; el servidor tambien lo rechaza.
  const busyElsewhere = !["ready", "published", "failed", "publishing"].includes(videoStatus);
  // Un solo booleano manda sobre el boton: en curso segun el servidor, o encolado desde aqui.
  const locked = publishing || enqueued || submitting || busyElsewhere;

  async function onPublish(force = false) {
    setSubmitting(true);
    setResult(null);
    setConfirming(false);
    setDuplicateBlocked(false);
    try {
      const response = await fetch(`/api/videos/${videoId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformAccountId: accountId,
          confirmDuplicate: force || Boolean(alreadyHere),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setEnqueued(true);
        setResult({
          kind: "ok",
          text: "Subida encolada. Tarda unos minutos; esta seccion se actualiza sola cuando termina.",
        });
        router.refresh();
        notifyVideoChanged(videoId);
      } else {
        // Antes los fallos se ignoraban en silencio (`if (response.ok)` sin rama else), asi que un
        // error se veia igual que un exito y la reaccion natural era volver a darle al boton.
        if (body.code === "already_published") setDuplicateBlocked(true);
        // Si el rechazo es porque ya hay una subida en curso, el boton se queda bloqueado: darle
        // otra vez no ayuda, y la pagina se refresca sola cuando el worker termine.
        if (body.code === "publish_in_progress") setEnqueued(true);
        setResult({
          kind: "error",
          text: body.error?.toString() ?? `Fallo al publicar (HTTP ${response.status}).`,
        });
        router.refresh();
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
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Check className="h-4 w-4 text-primary" />
            Este video ya esta publicado
          </p>
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

      {/* Cargador de la subida: la unica senal de que algo esta pasando mientras el worker sube el
          archivo a la plataforma. No hay porcentaje real (lo sube el worker, no el navegador). */}
      {locked && !busyElsewhere && !duplicateBlocked && (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {publishing ? "Subiendo el video a la plataforma..." : "Subida encolada, esperando al worker..."}
          </p>
          <Progress indeterminate />
          <p className="text-xs text-muted-foreground">
            No cierres esta pestana ni vuelvas a darle a publicar: suele tardar unos minutos y el enlace
            aparecera aqui arriba cuando termine.
          </p>
        </div>
      )}

      <div className="flex max-w-md items-end gap-3">
        <div className="flex-1 space-y-2">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={locked}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        {confirming ? (
          <div className="flex gap-2">
            <Button onClick={() => onPublish()} disabled={locked}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? "Enviando..." : "Si, publicar"}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={submitting}>
              Cancelar
            </Button>
          </div>
        ) : (
          // Se confirma porque publicar es irreversible desde aqui: el video queda visible en la
          // plataforma y borrarlo hay que hacerlo a mano en YouTube Studio.
          <Button onClick={() => setConfirming(true)} disabled={locked}>
            {locked && !busyElsewhere ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {locked && !busyElsewhere
              ? "Publicando..."
              : alreadyHere
                ? "Publicar otra vez"
                : "Publicar"}
          </Button>
        )}
      </div>

      {busyElsewhere && (
        <p className="text-xs text-muted-foreground">
          Hay un render en curso; el boton se habilita cuando termine.
        </p>
      )}

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

      {duplicateBlocked && (
        <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-xs">
            El servidor bloqueo la subida porque este video ya esta en esa cuenta. Solo continua si de
            verdad quieres un segundo video identico en el canal.
          </p>
          <Button variant="destructive" size="sm" disabled={submitting} onClick={() => onPublish(true)}>
            Publicar de todas formas
          </Button>
        </div>
      )}
    </div>
  );
}
