"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Le pide a la IA que lea los guiones que mejor y peor rindieron y proponga PREGUNTAS nuevas para
 * medir, mas alla de las que estan escritas en el codigo.
 *
 * Es deliberadamente manual: proponer cuesta llamadas al LLM y clasificar el canal entero cuesta una
 * por video, y volver a correrlo sin videos nuevos de por medio solo pagaria por mirar casi la misma
 * muestra otra vez.
 */
export function DiscoverDimensionsButton({
  eligibility,
}: {
  eligibility: { enabled: boolean; reason: string | null; unlockHint: string | null; usableSamples: number };
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const usableSamples = eligibility.usableSamples;

  async function onDiscover() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch("/api/learnings/discover-dimensions", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setMessage({
          kind: "ok",
          text: `Analizando ${body.samples ?? usableSamples} videos. Las preguntas nuevas aparecen aqui en cuanto termine de clasificar el canal (puede tardar un par de minutos).`,
        });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: body.error?.toString() ?? "No se pudo encolar." });
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-4">
      <Button
        type="button"
        variant="outline"
        disabled={running || !eligibility.enabled}
        onClick={onDiscover}
      >
        <Sparkles className={running ? "mr-2 h-4 w-4 animate-pulse" : "mr-2 h-4 w-4"} />
        {running ? "Analizando..." : "Buscar patrones nuevos"}
      </Button>

      {eligibility.enabled ? (
        <p className="text-xs text-muted-foreground">
          La IA lee tus guiones que mejor y peor rindieron y propone preguntas nuevas que medir. Solo
          propone la hipotesis: si es cierta o no lo decide el mismo motor de datos que todo lo demas,
          asi que una pregunta sin sentido nunca llega a convertirse en leccion.
        </p>
      ) : (
        // El boton bloqueado dice POR QUE y QUE FALTA. Un boton gris sin explicacion se lee como algo
        // roto; con la razon al lado se lee como lo que es: todavia no aporta apretarlo.
        <div className="space-y-1">
          <p className="text-xs font-medium">Bloqueado: {eligibility.reason}</p>
          <p className="text-xs text-muted-foreground">{eligibility.unlockHint}</p>
        </div>
      )}

      {message && (
        <p className={message.kind === "ok" ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
