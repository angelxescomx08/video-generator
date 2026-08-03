"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { VideoVersion } from "@video-generator/db";
import type { CostItem, CostStage } from "@video-generator/types";

type VersionWithCost = VideoVersion & {
  isCurrent: boolean;
  costBreakdown: CostItem[] | null;
  costTotalUsd: string | null;
  costTotalMxn: string | null;
  exchangeRateUsed: string | null;
};

const STAGE_LABELS: Record<CostStage, string> = {
  script: "Guion (IA)",
  edl: "Edicion (IA)",
  tts: "Voz",
  stock_footage: "Video (stock)",
  render: "Render",
};

function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? 4 : 2)}`;
}

function formatMxn(amount: number): string {
  return `$${amount.toFixed(2)} MXN`;
}

export function CostPanel({ videoId }: { videoId: string }) {
  const [versions, setVersions] = useState<VersionWithCost[] | null>(null);

  useEffect(() => {
    fetch(`/api/videos/${videoId}/versions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setVersions(data));
  }, [videoId]);

  if (!versions || versions.length === 0) return null;

  const totalUsd = versions.reduce((sum, v) => sum + Number(v.costTotalUsd ?? 0), 0);
  const totalMxn = versions.reduce((sum, v) => sum + Number(v.costTotalMxn ?? 0), 0);

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Costo de generacion</h3>
      <div className="rounded-md border border-border p-3">
        <p className="text-sm text-muted-foreground">Costo total (todas las versiones)</p>
        <p className="text-lg font-semibold">
          {formatUsd(totalUsd)} USD · {formatMxn(totalMxn)}
        </p>
      </div>

      <ul className="space-y-2">
        {versions.map((v) => (
          <li key={v.id} className="rounded-md border border-border p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                v{v.versionNumber}
                {v.isCurrent && <Badge className="ml-2">Actual</Badge>}
              </span>
              <span className="font-medium">
                {formatUsd(Number(v.costTotalUsd ?? 0))} · {formatMxn(Number(v.costTotalMxn ?? 0))}
              </span>
            </div>
            <ul className="space-y-1">
              {(v.costBreakdown ?? []).map((item, i) => (
                <li key={i} className="flex items-center justify-between text-muted-foreground">
                  <span>
                    {STAGE_LABELS[item.stage] ?? item.stage} — {item.providerName}
                  </span>
                  {item.isFree ? (
                    <Badge variant="secondary">{item.isLocal ? "Gratis (local)" : "Gratis"}</Badge>
                  ) : (
                    <span>{formatUsd(item.amountUsd)}</span>
                  )}
                </li>
              ))}
            </ul>
            {v.exchangeRateUsed && (
              <p className="mt-2 text-xs text-muted-foreground">
                Tipo de cambio usado: {Number(v.exchangeRateUsed).toFixed(2)} MXN/USD
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
