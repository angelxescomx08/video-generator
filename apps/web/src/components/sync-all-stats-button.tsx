"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type SyncRun = { id: string; status: "queued" | "active" | "completed"; totalCount: number; completedCount: number; failedCount: number };

/** Polls only while a user initiated run is active; the source of truth is Postgres, not component state. */
export function SyncAllStatsButton({ linkedCount }: { linkedCount: number }) {
  const router = useRouter();
  const [run, setRun] = useState<SyncRun | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!run || run.status === "completed") return;
    const poll = async () => {
      const response = await fetch(`/api/stats/sync/${run.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as SyncRun;
      setRun(next);
      if (next.status === "completed") router.refresh();
    };
    const timer = window.setInterval(poll, 1200);
    void poll();
    return () => window.clearInterval(timer);
  }, [router, run?.id, run?.status]);

  async function onSync() {
    setMessage(null);
    try {
      const response = await fetch("/api/stats/refresh-all", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.ok) setRun({ id: body.syncRunId, status: "queued", totalCount: body.videos ?? linkedCount, completedCount: 0, failedCount: 0 });
      else setMessage({ kind: "error", text: body.error?.toString() ?? "No se pudo iniciar la sincronizacion." });
    } catch {
      setMessage({ kind: "error", text: "No se pudo iniciar la sincronizacion." });
    }
  }

  const processed = run ? run.completedCount + run.failedCount : 0;
  const percent = run && run.totalCount > 0 ? Math.round((processed / run.totalCount) * 100) : 0;
  const active = run !== null && run.status !== "completed";

  return <div className="flex max-w-xl flex-col gap-3">
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" disabled={active || linkedCount === 0} onClick={onSync}>
        <RefreshCw className={active ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
        {active ? "Sincronizando analiticas..." : "Sincronizar todo desde YouTube"}
      </Button>
      {run?.status === "completed" && <p className="text-sm text-muted-foreground">Sincronizacion terminada: {run.completedCount} correctos{run.failedCount ? `, ${run.failedCount} con error` : ""}.</p>}
      {message && <p className="text-sm text-destructive">{message.text}</p>}
    </div>
    {run && <div className="space-y-1" aria-live="polite">
      <div className="flex justify-between text-sm text-muted-foreground"><span>{active ? "Actualizando videos" : "Ultima sincronizacion"}</span><span>{processed} de {run.totalCount} ({percent}%)</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div>
      {run.failedCount > 0 && <p className="text-xs text-destructive">{run.failedCount} video(s) no se pudieron sincronizar.</p>}
    </div>}
    {linkedCount === 0 && <p className="text-sm text-muted-foreground">No hay videos vinculados todavia, asi que no hay de donde traer datos.</p>}
  </div>;
}
