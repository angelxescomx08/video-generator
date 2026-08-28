"use client";

import { useCallback, useEffect, useState } from "react";
import { useVideoDataRefresh } from "@/lib/video-refresh";
import { CostDisclaimer } from "@/components/cost-disclaimer";
import type { CostStage } from "@video-generator/types";
import {
  formatMxn,
  formatUsd,
  STAGE_LABELS,
  summarizeVersionCosts,
  type VersionLike,
} from "@/lib/version-costs";

type VersionWithCost = VersionLike & { isCurrent: boolean };

const FALLBACK_RATE = 18.5;

export function CostPanel({ videoId }: { videoId: string }) {
  const [versions, setVersions] = useState<VersionWithCost[] | null>(null);

  const load = useCallback(() => {
    fetch(`/api/videos/${videoId}/versions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setVersions(data))
      .catch(() => {
        // se reintenta en el proximo aviso de cambio
      });
  }, [videoId]);

  useEffect(() => {
    load();
  }, [load]);

  // Igual que el panel de versiones: los costos vienen por fetch, asi que hay que recargarlos a mano
  // cuando el video cambia (una version nueva cambia el total).
  useVideoDataRefresh(videoId, load);

  if (!versions || versions.length === 0) return null;

  const { perVersion, totalUsd, totalMxn, totalSavedUsd } = summarizeVersionCosts(versions, FALLBACK_RATE);

  // Total gastado por etapa a lo largo de TODAS las versiones: responde "en que se fue el dinero".
  const byStage = new Map<CostStage, number>();
  for (const version of perVersion) {
    for (const item of version.items) {
      byStage.set(item.stage, (byStage.get(item.stage) ?? 0) + item.amountUsd);
    }
  }
  const stageRows = [...byStage.entries()].filter(([, usd]) => usd > 0).sort((a, b) => b[1] - a[1]);
  const rate = totalUsd > 0 ? totalMxn / totalUsd : FALLBACK_RATE;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">Costo de produccion</h3>
        <p className="text-sm text-muted-foreground">
          Suma de todas las versiones. El detalle de cada una esta en su tarjeta, arriba.
        </p>
      </div>

      <div className="rounded-md border border-border p-4">
        <p className="text-xs text-muted-foreground">Total gastado en este video</p>
        <p className="text-2xl font-semibold tabular-nums">{formatUsd(totalUsd)}</p>
        <p className="text-sm text-muted-foreground tabular-nums">{formatMxn(totalMxn)}</p>
        {totalSavedUsd > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Se ahorraron <span className="font-medium text-foreground">{formatUsd(totalSavedUsd)}</span>{" "}
            reutilizando guion, voz y clips entre versiones en vez de regenerarlos.
          </p>
        )}
      </div>

      {stageRows.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-border p-3">
          <p className="text-xs font-medium">En que se gasto</p>
          {stageRows.map(([stage, usd]) => (
            <div key={stage} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{STAGE_LABELS[stage] ?? stage}</span>
                <span className="tabular-nums">
                  {formatUsd(usd)} · {formatMxn(usd * rate)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${totalUsd > 0 ? (usd / totalUsd) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <CostDisclaimer />
    </section>
  );
}
