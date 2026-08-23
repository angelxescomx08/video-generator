"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VideoVersion } from "@video-generator/db";
import type { CostItem, EditDecisionList } from "@video-generator/types";
import {
  formatMxn,
  formatUsd,
  STAGE_LABELS,
  summarizeVersionCosts,
  type VersionCostSummary,
} from "@/lib/version-costs";

/** `costBreakdown` es jsonb sin `$type` en el schema, asi que llega como `unknown`: se acota aqui. */
type VersionWithFlag = Omit<VideoVersion, "costBreakdown"> & {
  isCurrent: boolean;
  costBreakdown: CostItem[] | null;
};

const FALLBACK_RATE = 18.5;

function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Saca la musica de fondo del EDL guardado en la version, para distinguirlas de un vistazo. */
function musicOf(version: VideoVersion): string | null {
  const audio = (version.edl as EditDecisionList | null)?.audio;
  if (!audio?.backgroundMusicPath) return null;
  return audio.backgroundMusicLabel ?? "Musica de fondo";
}

function VersionCostDetail({ summary }: { summary: VersionCostSummary }) {
  const paidItems = summary.items.filter((i) => i.amountUsd > 0);
  const freeItems = summary.items.filter((i) => i.amountUsd === 0);

  return (
    <div className="space-y-2 border-t border-border pt-2 text-xs">
      {paidItems.length > 0 && (
        <ul className="space-y-1">
          {paidItems.map((item, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {STAGE_LABELS[item.stage] ?? item.stage} · {item.providerName}
              </span>
              <span className="tabular-nums">{formatUsd(item.amountUsd)}</span>
            </li>
          ))}
        </ul>
      )}

      {freeItems.length > 0 && (
        <p className="text-muted-foreground">
          Gratis en esta version:{" "}
          {freeItems.map((i) => `${STAGE_LABELS[i.stage] ?? i.stage} (${i.providerName})`).join(", ")}
        </p>
      )}

      {summary.reusedStages.length > 0 && (
        <div className="rounded-md bg-muted/60 p-2">
          <p className="font-medium text-foreground">
            Reutilizado sin volver a pagar: {summary.reusedStages.map((s) => STAGE_LABELS[s]).join(", ")}
          </p>
          <p className="text-muted-foreground">
            Regenerar eso habria costado {formatUsd(summary.savedUsd)} ({formatMxn(summary.savedMxn)}).
          </p>
        </div>
      )}

      <p className="text-muted-foreground">
        Acumulado de produccion hasta esta version:{" "}
        <span className="font-medium text-foreground tabular-nums">
          {formatUsd(summary.cumulativeUsd)} · {formatMxn(summary.cumulativeMxn)}
        </span>
      </p>
    </div>
  );
}

export function VideoVersionsPanel({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [versions, setVersions] = useState<VersionWithFlag[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    const response = await fetch(`/api/videos/${videoId}/versions`);
    if (response.ok) setVersions(await response.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  async function onRestore(versionId: string) {
    if (!confirm("Activar esta version? El video pasara a usar este render.")) return;
    setRestoringId(versionId);
    try {
      const response = await fetch(`/api/videos/${videoId}/versions/${versionId}/activate`, { method: "POST" });
      if (response.ok) {
        await load();
        router.refresh();
      }
    } finally {
      setRestoringId(null);
    }
  }

  if (!versions || versions.length === 0) return null;

  const { perVersion, totalUsd, totalMxn, totalSavedUsd } = summarizeVersionCosts(versions, FALLBACK_RATE);
  const summaryById = new Map(perVersion.map((s) => [s.versionId, s]));

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">Versiones</h3>
        <p className="text-sm text-muted-foreground">
          Cada cambio genera una version nueva y las anteriores se conservan. Activa la que quieras dejar
          como definitiva.
        </p>
      </div>

      {/* Resumen de produccion: lo que costo el video completo sumando todas las versiones */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Versiones</p>
          <p className="text-lg font-semibold tabular-nums">{versions.length}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Costo total de produccion</p>
          <p className="text-lg font-semibold tabular-nums">{formatUsd(totalUsd)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{formatMxn(totalMxn)}</p>
        </div>
        <div className="col-span-2 rounded-md border border-border p-3 sm:col-span-1">
          <p className="text-xs text-muted-foreground">Ahorrado reutilizando material</p>
          <p className="text-lg font-semibold tabular-nums">{formatUsd(totalSavedUsd)}</p>
          <p className="text-xs text-muted-foreground">
            {totalSavedUsd > 0 ? "vs. regenerar todo cada vez" : "aun no hay reutilizacion"}
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {versions.map((v) => {
          const music = musicOf(v);
          const summary = summaryById.get(v.id);
          const isRestoring = restoringId === v.id;
          const isExpanded = expandedId === v.id;

          return (
            <li
              key={v.id}
              className={`space-y-2 rounded-lg border p-3 transition-colors ${
                v.isCurrent ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold">v{v.versionNumber}</span>
                {v.isCurrent && <Badge>En uso</Badge>}
                <Badge variant={music ? "default" : "secondary"}>{music ?? "Sin musica"}</Badge>
                {summary && summary.reusedStages.length > 0 && (
                  <Badge variant="outline">solo re-render</Badge>
                )}
              </div>

              <video
                controls
                preload="metadata"
                src={`/api/videos/${videoId}/versions/${v.id}/file`}
                className="aspect-[9/16] max-h-72 w-full rounded-md border border-border bg-black object-contain"
              />

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div>
                  <dt className="text-muted-foreground">Duracion</dt>
                  <dd className="font-medium tabular-nums">{formatDuration(v.durationSeconds)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Costo de esta version</dt>
                  <dd className="font-medium tabular-nums">
                    {summary ? formatUsd(summary.newCostUsd) : "--"}
                    {summary && summary.newCostUsd === 0 && (
                      <span className="ml-1 font-normal text-muted-foreground">(sin costo extra)</span>
                    )}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Creada</dt>
                  <dd className="font-medium">{new Date(v.createdAt).toLocaleString()}</dd>
                </div>
              </dl>

              {summary && isExpanded && <VersionCostDetail summary={summary} />}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  variant={v.isCurrent ? "outline" : "default"}
                  size="sm"
                  disabled={v.isCurrent || isRestoring}
                  onClick={() => onRestore(v.id)}
                >
                  {v.isCurrent ? "En uso" : isRestoring ? "Activando..." : "Usar esta"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedId(isExpanded ? null : v.id)}
                >
                  {isExpanded ? "Ocultar costos" : "Ver costos"}
                </Button>
                <a
                  href={`/api/videos/${videoId}/versions/${v.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  Abrir
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
