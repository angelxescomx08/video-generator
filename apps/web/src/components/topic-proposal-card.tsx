"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DURATION_LIMITS } from "@video-generator/types";

export interface TopicProposalView {
  id: string;
  title: string;
  idea: string;
  angle: string;
  status: string;
  sources: Array<{ title: string; url: string; source: string }>;
  similarityScore: number | null;
  similarToVideoId: string | null;
  createdVideoId: string | null;
  searchQuery: string | null;
}

/**
 * Una propuesta, con todo lo necesario para decidir sin salir de la pantalla.
 *
 * La idea es EDITABLE antes de aprobar porque ese es el "pulirlo" del flujo: una propuesta suele
 * estar cerca pero no exacta, y obligar a aceptarla tal cual o tirarla convierte cada correccion
 * menor en un rechazo mas un video escrito a mano. Lo que se guarda en `videos.topic` es lo que
 * quede en el cuadro de texto, no lo que dijo la IA.
 */
export function TopicProposalCard({ proposal }: { proposal: TopicProposalView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [idea, setIdea] = useState(`${proposal.title}. ${proposal.idea}`);
  const [format, setFormat] = useState<"long" | "short">("short");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decided = proposal.status === "approved" || proposal.status === "rejected";

  async function act(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/topics/${proposal.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, format, idea: action === "approve" ? idea : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo completar la accion");
      if (data.videoId) router.push(`/videos/${data.videoId}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold">{proposal.title}</h3>
        <StatusBadge status={proposal.status} />
      </div>

      <p className="text-sm text-muted-foreground">{proposal.idea}</p>

      <p className="text-sm">
        <span className="font-medium">Por que engancharia:</span>{" "}
        <span className="text-muted-foreground">{proposal.angle}</span>
      </p>

      {proposal.sources.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">En que se apoya:</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {proposal.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {s.title}
                </a>{" "}
                <span className="opacity-70">({s.source})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Sin fuentes: la busqueda no devolvio nada util y esto sale del conocimiento del modelo.
          Verificalo antes de aprobarlo.
        </p>
      )}

      {proposal.similarToVideoId && (
        <p className="text-xs text-muted-foreground">
          Lo mas parecido que ya hiciste:{" "}
          <Link href={`/videos/${proposal.similarToVideoId}`} className="underline underline-offset-2">
            ver ese video
          </Link>{" "}
          ({Math.round((proposal.similarityScore ?? 0) * 100)}% de similitud con su guion)
        </p>
      )}

      {proposal.createdVideoId && (
        <p className="text-xs">
          <Link href={`/videos/${proposal.createdVideoId}`} className="underline underline-offset-2">
            Ver el video que salio de esta idea
          </Link>
        </p>
      )}

      {!decided && (
        <div className="space-y-3 border-t border-border pt-3">
          {open ? (
            <>
              <div className="space-y-2">
                <Label htmlFor={`idea-${proposal.id}`}>Idea que se le pasara al guionista</Label>
                <Textarea
                  id={`idea-${proposal.id}`}
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={5}
                  className="resize-y text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Editala si hace falta: se guarda esto, no lo que propuso la IA.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor={`format-${proposal.id}`}>Formato</Label>
                  <Select
                    id={`format-${proposal.id}`}
                    value={format}
                    onChange={(e) => setFormat(e.target.value as "long" | "short")}
                  >
                    <option value="short">Short ({DURATION_LIMITS.short.default}s)</option>
                    <option value="long">Video largo ({DURATION_LIMITS.long.default}s)</option>
                  </Select>
                </div>
                <Button type="button" onClick={() => act("approve")} disabled={busy || !idea.trim()}>
                  {busy ? "Creando..." : "Crear video"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => setOpen(true)} disabled={busy}>
                Usar esta idea
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => act("reject")} disabled={busy}>
                Descartar
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    rejected: "bg-muted text-muted-foreground",
    duplicate: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };
  const labels: Record<string, string> = {
    pending: "Nueva",
    approved: "Aprobada",
    rejected: "Descartada",
    duplicate: "Repetida",
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.rejected}`}>
      {labels[status] ?? status}
    </span>
  );
}
