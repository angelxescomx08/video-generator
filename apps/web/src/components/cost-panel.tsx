"use client";

import { useCallback, useEffect, useState } from "react";
import { useVideoDataRefresh } from "@/lib/video-refresh";
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

/**
 * El desglose es un ESTIMADO, no una lectura de facturacion: ninguna de estas APIs devuelve un
 * costo. Decirlo explicitamente evita que estos numeros se tomen como la factura real, sobre todo
 * porque las capas gratuitas suelen dejar el cobro efectivo en cero.
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
          Cada version guarda una foto del costo del momento: actualizar la tabla de precios no recalcula
          versiones anteriores.
        </li>
      </ul>
    </details>
  );
}
