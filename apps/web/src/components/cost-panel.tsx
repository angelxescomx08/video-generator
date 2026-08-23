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

      <CostDisclaimer />
    </div>
  );
}

/**
 * El desglose de arriba es un ESTIMADO, no una lectura de facturacion: ninguna de estas APIs
 * devuelve un costo. Decirlo explicitamente evita que estos numeros se tomen como la factura real,
 * sobre todo porque las capas gratuitas suelen dejar el cobro efectivo en cero.
 */
function CostDisclaimer() {
  return (
    <details className="rounded-md border border-border bg-muted/50 p-3">
      <summary className="cursor-pointer text-xs font-medium">
        Como se calculan estos costos (estimados, no facturacion real)
      </summary>
      <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Es un estimado.</span> Ninguna API devuelve un
          costo. Se multiplica el uso real (tokens que reporta el modelo, caracteres enviados al TTS) por
          una tabla de precios que vive en el repositorio.
        </li>
        <li>
          <span className="font-medium text-foreground">No descuenta capas gratuitas.</span> Si estas en
          el free tier de Gemini o dentro del millon de caracteres mensuales gratis de Google TTS, lo que
          te facturan es <span className="font-medium text-foreground">$0</span> aunque aqui aparezca un
          monto. Lo que se muestra es el costo marginal una vez agotada esa cuota.
        </li>
        <li>
          <span className="font-medium text-foreground">Los precios se actualizan a mano.</span> Ultima
          revision: 23 de agosto de 2026. Varias tarifas de Gemini son promocionales y se duplican el 1 de
          enero de 2027; los alias tipo <code className="text-[11px]">gemini-flash-latest</code> pueden
          cambiar de modelo (y de precio) sin aviso.
        </li>
        <li>
          <span className="font-medium text-foreground">El tipo de cambio es fijo</span>, no una tasa en
          vivo. Se puede ajustar en Configuracion general.
        </li>
        <li>
          Los montos guardados en cada version son una foto del momento en que se genero: actualizar la
          tabla de precios no recalcula versiones anteriores.
        </li>
      </ul>
    </details>
  );
}
