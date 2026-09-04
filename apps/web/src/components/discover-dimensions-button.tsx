"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DiscoveryRunState } from "@video-generator/analytics";

/**
 * Le pide a la IA que lea los guiones que mejor y peor rindieron y proponga PREGUNTAS nuevas para
 * medir, mas alla de las que estan escritas en el codigo.
 *
 * Es deliberadamente manual: proponer cuesta llamadas al LLM y clasificar el canal entero cuesta una
 * por video, y volver a correrlo sin videos nuevos de por medio solo pagaria por mirar casi la misma
 * muestra otra vez.
 *
 * El job tarda alrededor de un minuto y lo ejecuta el worker, no este request: sin sondear el estado
 * de la corrida, apretar el boton solo dejaba una frase estatica y no habia forma de distinguir "esta
 * clasificando el canal" de "el worker esta caido y el job se quedo en la cola". Por eso lo que se
 * muestra es el estado de `dimension_discovery_runs`, que es donde de verdad vive el progreso.
 */

/** Cada cuanto se pregunta por el estado de la corrida. */
const POLL_MS = 2500;

/**
 * Cuanto se espera a que el worker levante el job antes de sospechar que no hay nadie escuchando la
 * cola. No cancela nada: solo cambia el texto, porque un job encolado sigue siendo valido cuando el
 * worker vuelva.
 */
const WORKER_SILENT_AFTER_S = 20;

type Phase = "idle" | "queued" | "running" | "done" | "failed" | "error";

export function DiscoverDimensionsButton({
  eligibility,
  initialRun,
}: {
  eligibility: { enabled: boolean; reason: string | null; unlockHint: string | null; usableSamples: number };
  initialRun: DiscoveryRunState | null;
}) {
  const router = useRouter();
  const usableSamples = eligibility.usableSamples;

  // Si la pagina se carga con una corrida ya en curso (un refresco a media clasificacion), el boton
  // retoma el seguimiento en vez de fingir que no pasa nada.
  const [phase, setPhase] = useState<Phase>(initialRun?.status === "running" ? "running" : "idle");
  const [run, setRun] = useState<DiscoveryRunState | null>(initialRun);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Lo que habia ANTES de encolar. Sirve para no confundir la corrida vieja con la que se acaba de
  // pedir durante los segundos en que el worker todavia no inserto su fila.
  const previousRunId = useRef<string | null>(initialRun?.status === "running" ? null : initialRun?.id ?? null);
  const polling = useRef(false);

  const active = phase === "queued" || phase === "running";

  const readRun = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const response = await fetch("/api/learnings/discover-dimensions", { cache: "no-store" });
      if (!response.ok) return;
      const { run: latest } = (await response.json()) as { run: DiscoveryRunState | null };
      if (!latest || latest.id === previousRunId.current) return; // el worker aun no la ha creado

      setRun(latest);
      if (latest.status === "running") {
        setPhase("running");
        return;
      }
      setPhase(latest.status === "completed" ? "done" : "failed");
      // Las preguntas nuevas las pinta el componente de servidor: sin este refresh el usuario lee
      // "listo" y sigue viendo la misma lista de antes.
      router.refresh();
    } finally {
      polling.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(readRun, POLL_MS);
    return () => clearInterval(id);
  }, [active, readRun]);

  // Reloj propio: un contador que avanza es la unica prueba de vida que se puede dar mientras el
  // worker no reporte progreso mas fino que "corriendo".
  useEffect(() => {
    if (!active) return;
    const startedAt = run?.status === "running" ? new Date(run.startedAt).getTime() : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, run?.status, run?.startedAt]);

  async function onDiscover() {
    setPhase("queued");
    setErrorText(null);
    setElapsed(0);
    previousRunId.current = run?.id ?? null;
    try {
      const response = await fetch("/api/learnings/discover-dimensions", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPhase("error");
        setErrorText(body.error?.toString() ?? "No se pudo encolar.");
        return;
      }
      previousRunId.current = body.previousRunId ?? null;
      void readRun();
    } catch (err) {
      setPhase("error");
      setErrorText((err as Error).message);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-4">
      <Button type="button" variant="outline" disabled={active || !eligibility.enabled} onClick={onDiscover}>
        {active ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
        {active ? "Analizando..." : "Buscar patrones nuevos"}
      </Button>

      {eligibility.enabled && !active ? (
        <p className="text-xs text-muted-foreground">
          La IA lee tus guiones que mejor y peor rindieron y propone preguntas nuevas que medir. Solo
          propone la hipotesis: si es cierta o no lo decide el mismo motor de datos que todo lo demas,
          asi que una pregunta sin sentido nunca llega a convertirse en leccion.
        </p>
      ) : null}

      {!eligibility.enabled && !active ? (
        // El boton bloqueado dice POR QUE y QUE FALTA. Un boton gris sin explicacion se lee como algo
        // roto; con la razon al lado se lee como lo que es: todavia no aporta apretarlo.
        <div className="space-y-1">
          <p className="text-xs font-medium">Bloqueado: {eligibility.reason}</p>
          <p className="text-xs text-muted-foreground">{eligibility.unlockHint}</p>
        </div>
      ) : null}

      {active ? <Progress phase={phase} elapsed={elapsed} samples={usableSamples} /> : null}

      {phase === "done" ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {run?.proposedCount
              ? `Listo: ${run.proposedCount} pregunta(s) nueva(s), ya clasificadas sobre el canal.`
              : "Listo, pero la IA no propuso ninguna pregunta bien formada esta vez. No se gasto ninguna ranura."}{" "}
            <Link href="/analytics/discoveries" className="underline">
              Ver que pregunto y por que
            </Link>
            .
          </span>
        </p>
      ) : null}

      {phase === "failed" || phase === "error" ? (
        <p className="flex items-start gap-2 text-xs text-destructive">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{errorText ?? run?.errorMessage ?? "El analisis fallo."}</span>
        </p>
      ) : null}

      {phase !== "done" ? (
        <p className="text-xs">
          <Link href="/analytics/discoveries" className="underline">
            Ver las preguntas que ya propuso y en que quedaron
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Progress({ phase, elapsed, samples }: { phase: Phase; elapsed: number; samples: number }) {
  const stalled = phase === "queued" && elapsed >= WORKER_SILENT_AFTER_S;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">
        {phase === "queued"
          ? stalled
            ? `En la cola desde hace ${formatElapsed(elapsed)}, sin que nadie lo tome.`
            : "Encolado, esperando al worker..."
          : `Leyendo guiones y clasificando ${samples} videos — ${formatElapsed(elapsed)}`}
      </p>
      <p className="text-xs text-muted-foreground">
        {stalled
          ? "El job sigue valido y arrancara solo en cuanto el worker vuelva; revisa que este corriendo (pnpm dev o pnpm start)."
          : "Es una llamada al LLM para proponer las preguntas y otra por video para etiquetarlo, asi que suele tardar un par de minutos. Puedes irte de esta pantalla: el trabajo lo hace el worker y al volver veras el resultado."}
      </p>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
