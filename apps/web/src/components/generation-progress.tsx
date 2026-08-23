"use client";

import { useEffect, useState } from "react";
import { FileText, Mic, Film, Wand2, Clapperboard, Upload, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoStatus } from "@video-generator/db";

interface Step {
  status: VideoStatus;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Peso relativo en tiempo, para que el porcentaje no avance a saltos iguales por etapa. */
  weight: number;
}

const STEPS: Step[] = [
  { status: "generating_script", label: "Guion", description: "La IA esta escribiendo el guion", icon: FileText, weight: 1 },
  { status: "generating_tts", label: "Voz", description: "Generando la narracion con TTS", icon: Mic, weight: 2 },
  { status: "fetching_stock", label: "Clips", description: "Buscando y descargando footage de stock", icon: Film, weight: 2 },
  { status: "building_edl", label: "Edicion", description: "La IA decide efectos y transiciones", icon: Wand2, weight: 1 },
  { status: "rendering", label: "Render", description: "ffmpeg esta montando el video final", icon: Clapperboard, weight: 4 },
  { status: "publishing", label: "Publicar", description: "Subiendo el video a la plataforma", icon: Upload, weight: 1 },
];

/** Solo se re-renderiza (p.ej. al cambiar la musica): no se vuelve a generar guion, voz ni clips. */
const RENDER_ONLY_STEPS: Step[] = STEPS.filter((s) => s.status === "rendering" || s.status === "publishing");

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function GenerationProgress({
  status,
  /** true cuando el video ya tenia un render y solo se esta volviendo a montar. */
  renderOnly = false,
}: {
  status: VideoStatus;
  renderOnly?: boolean;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const steps = renderOnly ? RENDER_ONLY_STEPS : STEPS;
  const activeIndex = steps.findIndex((s) => s.status === status);
  const queued = status === "queued";
  const visible = queued || activeIndex !== -1;

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => setElapsedSeconds((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  // Porcentaje ponderado por duracion tipica de cada etapa: el render pesa mucho mas que el guion,
  // asi que un stepper de pasos iguales daba la sensacion de "atascado en el 83%".
  const totalWeight = steps.reduce((sum, s) => sum + s.weight, 0);
  const completedWeight = steps.slice(0, Math.max(activeIndex, 0)).reduce((sum, s) => sum + s.weight, 0);
  const activeWeight = activeIndex >= 0 ? steps[activeIndex]!.weight * 0.5 : 0;
  const percent = queued ? 2 : Math.round(((completedWeight + activeWeight) / totalWeight) * 100);

  const activeStep = activeIndex >= 0 ? steps[activeIndex] : undefined;

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-5">
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-primary/20">
        <div className="h-full w-1/3 animate-progress-slide bg-primary" />
      </div>

      {/* Encabezado: que se esta haciendo, en que paso va y cuanto lleva */}
      <div className="mb-4 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            <span className="text-sm font-semibold">
              {queued
                ? "En cola, esperando un worker libre"
                : (activeStep?.description ?? "Procesando")}
            </span>
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{percent}%</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
          {!queued && activeIndex >= 0 && (
            <span>
              Paso {activeIndex + 1} de {steps.length}
              {activeStep ? ` · ${activeStep.label}` : ""}
            </span>
          )}
          <span className="tabular-nums">Llevas {formatElapsed(elapsedSeconds)} en esta pantalla</span>
          {renderOnly && <span className="font-medium text-foreground">Solo re-render: no se regenera guion ni voz</span>}
        </div>
      </div>

      {/* stepper */}
      <ol className="flex items-start">
        {steps.map((step, i) => {
          const done = !queued && i < activeIndex;
          const active = !queued && i === activeIndex;
          const Icon = step.icon;
          return (
            <li key={step.status} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex w-full items-center">
                <div
                  className={cn(
                    "h-px flex-1 transition-colors duration-500",
                    i === 0 ? "bg-transparent" : done || active ? "bg-primary" : "bg-border",
                  )}
                />
                <div className="relative">
                  {active && <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />}
                  <div
                    className={cn(
                      "relative flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-500",
                      done && "border-primary bg-primary text-primary-foreground",
                      active && "border-primary bg-background text-primary shadow-md",
                      !done && !active && "border-border bg-muted text-muted-foreground/60",
                    )}
                  >
                    {done ? <Check className="h-4 w-4" /> : <Icon className={cn("h-4 w-4", active && "animate-pulse")} />}
                  </div>
                </div>
                <div
                  className={cn(
                    "h-px flex-1 transition-colors duration-500",
                    i === steps.length - 1 ? "bg-transparent" : done ? "bg-primary" : "bg-border",
                  )}
                />
              </div>
              <span
                className={cn(
                  "text-center text-[11px] font-medium transition-colors",
                  active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/50",
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="relative h-full overflow-hidden rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%` }}
        >
          <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-primary-foreground/40 to-transparent" />
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        {status === "rendering"
          ? "El render es la etapa mas larga; en un Short suele tardar varios minutos."
          : "Esta pantalla se actualiza sola cada 3 segundos."}
      </p>
    </div>
  );
}
