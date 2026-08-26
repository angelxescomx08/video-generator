"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Re-renderiza el video reusando guion, voz y clips. Sirve para aplicar mejoras del render a un video
 * ya generado sin volver a pagar IA ni TTS.
 */
export function RerenderButton({ videoId, disabled }: { videoId: string; disabled?: boolean }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/videos/${videoId}/rerender`, { method: "POST" });
      if (response.ok) {
        router.refresh();
      } else {
        const body = await response.json().catch(() => ({}));
        setError(body.error?.toString() ?? "No se pudo encolar el render.");
      }
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Volver a renderizar</p>
        <p className="text-xs text-muted-foreground">
          Corre ffmpeg otra vez con el mismo guion, la misma voz y los mismos clips. Sirve para aplicar
          mejoras del render (subtitulos, efectos, cortes) a un video que ya estaba hecho. No gasta nada de
          IA ni de voz, y queda como una version nueva por si prefieres volver a la anterior.
        </p>
      </div>
      <Button type="button" variant="outline" disabled={disabled || working} onClick={onClick}>
        <RotateCcw className={working ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
        {working ? "Encolando..." : "Volver a renderizar"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
