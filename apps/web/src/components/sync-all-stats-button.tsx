"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Adelanta el poll de todos los videos vinculados, sin esperar la vuelta del cron de cada 6h. */
export function SyncAllStatsButton({ linkedCount }: { linkedCount: number }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function onSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/stats/refresh-all", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setMessage({
          kind: "ok",
          text: `Sincronizacion encolada para ${body.videos ?? linkedCount} video(s). Recarga en unos segundos para ver los datos.`,
        });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: body.error?.toString() ?? "No se pudo encolar." });
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" disabled={syncing || linkedCount === 0} onClick={onSync}>
        <RefreshCw className={syncing ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
        {syncing ? "Sincronizando..." : "Sincronizar todo desde YouTube"}
      </Button>
      {message && (
        <p className={message.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
      {linkedCount === 0 && !message && (
        <p className="text-sm text-muted-foreground">
          No hay videos vinculados todavia, asi que no hay de donde traer datos.
        </p>
      )}
    </div>
  );
}
