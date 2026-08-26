"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { YOUTUBE_METRICS, type MetricImportance, type YoutubeMetricDef } from "@video-generator/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Valores ya guardados, para precargar el formulario con el ultimo snapshot. */
export type InitialMetrics = Partial<Record<string, number>>;

const GROUPS: { importance: MetricImportance; title: string; description: string }[] = [
  {
    importance: "critical",
    title: "Metricas clave",
    description:
      "Son las unicas que alimentan el aprendizaje de la IA. Si solo vas a llenar unas, llena estas: son las que distinguen 'el guion fallo' de 'el titulo fallo' de 'no lo distribuyeron'.",
  },
  {
    importance: "context",
    title: "Contexto",
    description:
      "No ensenan nada por si solas, pero sirven para interpretar las de arriba — sobre todo el tamano de muestra, que decide si un porcentaje es senal o ruido.",
  },
  {
    importance: "vanity",
    title: "Numeros de vanidad",
    description:
      "Se guardan para mostrarlos, no para aprender de ellos: dependen mas de cuanto te empujo el algoritmo que de la calidad del video.",
  },
];

const IMPORTANCE_BADGE: Record<MetricImportance, { label: string; variant: "default" | "secondary" | "outline" }> = {
  critical: { label: "Clave", variant: "default" },
  context: { label: "Contexto", variant: "secondary" },
  vanity: { label: "Vanidad", variant: "outline" },
};

export function PerformanceForm({
  videoId,
  initialMetrics,
  canPullFromApi,
}: {
  videoId: string;
  initialMetrics: InitialMetrics;
  canPullFromApi: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => toFormValues(initialMetrics));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = buildPayload(values, notes);
      const response = await fetch(`/api/videos/${videoId}/stats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        setMessage({ kind: "ok", text: "Estadisticas guardadas. Se usaran en la proxima generacion." });
        setNotes("");
        router.refresh();
      } else {
        const body = await response.json().catch(() => ({}));
        setMessage({ kind: "error", text: body.error?.toString() ?? "No se pudo guardar." });
      }
    } finally {
      setSaving(false);
    }
  }

  async function onPull() {
    setPulling(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/videos/${videoId}/stats/refresh`, { method: "POST" });
      if (response.ok) {
        setMessage({
          kind: "ok",
          text: "Se encolo el poll. Las metricas apareceran abajo en unos segundos; recarga la pagina para verlas.",
        });
      } else {
        const body = await response.json().catch(() => ({}));
        setMessage({ kind: "error", text: body.error?.toString() ?? "No se pudo encolar el poll." });
      }
    } finally {
      setPulling(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-muted/40 p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">Sincronizar analiticas desde YouTube</p>
          <p className="max-w-xl text-xs text-muted-foreground">
            {canPullFromApi
              ? "Trae todo lo que la API expone para este video: retencion, CTR, impresiones, suscriptores y la curva completa. La curva tarda hasta 48h desde la subida en existir, asi que en un video recien publicado ese campo llegara vacio y hay que volver a sincronizar despues."
              : "Primero vincula el video de YouTube arriba para activar este boton. Mientras tanto puedes registrar las metricas a mano abajo."}
          </p>
        </div>
        <Button type="button" disabled={!canPullFromApi || pulling} onClick={onPull}>
          <RefreshCw className={pulling ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
          {pulling ? "Sincronizando..." : "Sincronizar ahora"}
        </Button>
      </div>

      {GROUPS.map((group) => {
        const metrics = YOUTUBE_METRICS.filter((m) => m.importance === group.importance);
        const body = (
          <div className="grid gap-4 sm:grid-cols-2">
            {metrics.map((metric) => (
              <MetricField
                key={metric.key}
                metric={metric}
                value={values[metric.key] ?? ""}
                onChange={(next) => setValues((prev) => ({ ...prev, [metric.key]: next }))}
              />
            ))}
          </div>
        );

        // Las de vanidad van colapsadas: tenerlas siempre abiertas invita a llenarlas primero, que es
        // exactamente el habito que esta pantalla trata de romper.
        if (group.importance === "vanity") {
          return (
            <details key={group.importance} className="rounded-md border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">{group.title}</summary>
              <p className="mb-4 mt-2 text-xs text-muted-foreground">{group.description}</p>
              {body}
            </details>
          );
        }

        return (
          <section key={group.importance} className="space-y-4">
            <div className="border-b border-border pb-2">
              <h3 className="font-semibold">{group.title}</h3>
              <p className="text-xs text-muted-foreground">{group.description}</p>
            </div>
            {body}
          </section>
        );
      })}

      <div className="space-y-2">
        <Label htmlFor="notes">Nota libre (opcional)</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Algo que explique estos numeros y que no se vea en las metricas: lo comparti en un grupo, lo compartio una cuenta grande, lo subi a mala hora..."
        />
        <p className="text-xs text-muted-foreground">
          Sirve para que dentro de un mes puedas leer un numero raro y saber por que fue.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Guardando..." : "Guardar estadisticas"}
        </Button>
        {message && (
          <p className={message.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}

function MetricField({
  metric,
  value,
  onChange,
}: {
  metric: YoutubeMetricDef;
  value: string;
  onChange: (next: string) => void;
}) {
  const badge = IMPORTANCE_BADGE[metric.importance];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={metric.key} className="text-sm">
          {metric.label}
        </Label>
        <Badge variant={badge.variant} className="text-[10px]">
          {badge.label}
        </Badge>
        <InfoTooltip title={metric.label} body={metric.help} where={metric.whereToFind} />
      </div>
      <Input
        id={metric.key}
        inputMode="decimal"
        value={value}
        placeholder={PLACEHOLDERS[metric.unit]}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-[11px] text-muted-foreground">{UNIT_HINTS[metric.unit]}</p>
    </div>
  );
}

const PLACEHOLDERS: Record<YoutubeMetricDef["unit"], string> = {
  count: "330",
  percent: "39",
  seconds: "1:08",
  hours: "6.5",
};

const UNIT_HINTS: Record<YoutubeMetricDef["unit"], string> = {
  count: "Numero entero.",
  percent: "En porcentaje, sin el signo (39, no 0.39).",
  seconds: "Acepta m:ss como lo muestra Studio (1:08) o segundos sueltos (68).",
  hours: "En horas, con decimales.",
};

function toFormValues(initial: InitialMetrics): Record<string, string> {
  const result: Record<string, string> = {};
  for (const metric of YOUTUBE_METRICS) {
    const value = initial[metric.key];
    if (value === undefined || value === null) continue;
    // La duracion se muestra como m:ss para que coincida con lo que se ve en Studio y se pueda
    // comparar de un vistazo sin convertir a mano.
    result[metric.key] = metric.unit === "seconds" ? formatMinutesSeconds(value) : String(round(value));
  }
  return result;
}

/**
 * Convierte el formulario al payload de la API. Un campo vacio se OMITE en vez de mandarse como 0:
 * el backend guarda null ("aun no hay dato") y el motor de aprendizaje descarta nulls, mientras que
 * un 0 lo leeria como rendimiento real de cero y contaminaria los promedios del canal.
 */
function buildPayload(values: Record<string, string>, notes: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const metric of YOUTUBE_METRICS) {
    const raw = values[metric.key]?.trim();
    if (!raw) continue;
    const parsed = metric.unit === "seconds" ? parseDuration(raw) : Number(raw.replace(",", "."));
    if (parsed === null || !Number.isFinite(parsed)) continue;
    payload[metric.key] = metric.unit === "count" ? Math.round(parsed) : parsed;
  }

  if (notes.trim()) payload.notes = notes.trim();
  return payload;
}

/** Acepta "1:08" (como lo muestra Studio) o "68". */
function parseDuration(raw: string): number | null {
  if (raw.includes(":")) {
    const [minutes, seconds] = raw.split(":");
    const m = Number(minutes);
    const s = Number(seconds);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return m * 60 + s;
  }
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
