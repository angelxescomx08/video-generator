"use client";

import { FileText, Mic, Film, Wand2, Clapperboard, Upload, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoStatus } from "@video-generator/db";

interface Step {
  status: VideoStatus;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: Step[] = [
  { status: "generating_script", label: "Guion", description: "La IA esta escribiendo el guion", icon: FileText },
  { status: "generating_tts", label: "Voz", description: "Generando la narracion con TTS", icon: Mic },
  { status: "fetching_stock", label: "Clips", description: "Buscando footage de stock", icon: Film },
  { status: "building_edl", label: "Edicion", description: "La IA decide efectos y transiciones", icon: Wand2 },
  { status: "rendering", label: "Render", description: "ffmpeg esta montando el video final", icon: Clapperboard },
  { status: "publishing", label: "Publicar", description: "Subiendo el video a la plataforma", icon: Upload },
];

export function GenerationProgress({ status }: { status: VideoStatus }) {
  const activeIndex = STEPS.findIndex((s) => s.status === status);
  const queued = status === "queued";
  if (!queued && activeIndex === -1) return null;

  const percent = queued ? 3 : Math.round(((activeIndex + 0.5) / STEPS.length) * 100);
  const activeStep = activeIndex >= 0 ? STEPS[activeIndex] : undefined;

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-5">
      {/* barra de acento animada en el borde superior */}
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-primary/20">
        <div className="h-full w-1/3 animate-progress-slide bg-primary" />
      </div>

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-semibold">
            {queued ? "En cola, esperando un worker" : "Generando video"}
          </span>
        </div>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{percent}%</span>
      </div>

      {/* stepper */}
      <ol className="flex items-start">
        {STEPS.map((step, i) => {
          const done = !queued && i < activeIndex;
          const active = !queued && i === activeIndex;
          const Icon = step.icon;
          return (
            <li key={step.status} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex w-full items-center">
                <div className={cn("h-px flex-1 transition-colors duration-500", i === 0 ? "bg-transparent" : done || active ? "bg-primary" : "bg-border")} />
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
                <div className={cn("h-px flex-1 transition-colors duration-500", i === STEPS.length - 1 ? "bg-transparent" : done ? "bg-primary" : "bg-border")} />
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium transition-colors",
                  active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/50",
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* barra de progreso con shimmer */}
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="relative h-full overflow-hidden rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%` }}
        >
          <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-primary-foreground/40 to-transparent" />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-1.5">
        <p className="text-xs text-muted-foreground">
          {activeStep ? activeStep.description : "Tu video entrara al pipeline en cuanto haya un worker libre"}
        </p>
        <span className="flex gap-0.5">
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  );
}
