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
export function DiscoverDimensionsButton({ usableSamples }: { usableSamples: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={running} onClick={onDiscover}>
        <Sparkles className={running ? "mr-2 h-4 w-4 animate-pulse" : "mr-2 h-4 w-4"} />
        {running ? "Analizando..." : "Buscar patrones nuevos"}
      </Button>
      <p className="text-xs text-muted-foreground">
        La IA lee tus guiones que mejor y peor rindieron y propone preguntas nuevas que medir. Solo
        propone la hipotesis: si es cierta o no lo decide el mismo motor de datos que todo lo demas, asi
        que una pregunta sin sentido nunca llega a convertirse en leccion.
      </p>
      {message && (
        <p className={message.kind === "ok" ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
