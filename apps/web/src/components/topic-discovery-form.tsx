"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Lanza una busqueda de temas.
 *
 * La consulta es opcional a proposito: escribirla sirve para dirigir la busqueda a algo concreto
 * ("arqueologia biblica 2026"), pero dejarla vacia tiene que funcionar — el worker deriva una del
 * nombre del tema. Obligar a escribirla convertiria "que me proponga algo" en "yo ya se que buscar",
 * que es justo lo contrario de para lo que existe la pantalla.
 */
export function TopicDiscoveryForm({ themes }: { themes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [themeId, setThemeId] = useState(themes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setQueued(false);
    try {
      const response = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId, query: query.trim() || undefined }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "No se pudo lanzar la busqueda");
      setQueued(true);
      // El worker tarda: buscar + proponer + un embedding por idea. Se refresca despues para que las
      // propuestas aparezcan solas en vez de dejar al usuario recargando a mano.
      setTimeout(() => router.refresh(), 12000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setRunning(false);
    }
  }

  if (themes.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        No hay temas activos. Crea uno en <strong>Temas</strong> antes de buscar ideas.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="topic-theme">Tema del canal</Label>
          <Select id="topic-theme" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="topic-query">Que buscar (opcional)</Label>
          <Input
            id="topic-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ej. hallazgos arqueologicos que confirman relatos biblicos"
          />
        </div>
        <Button type="submit" disabled={running || !themeId}>
          {running ? "Lanzando..." : "Buscar ideas"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Si lo dejas vacio, busca por su cuenta a partir del nombre del tema. Cada corrida gasta una
        busqueda web, una llamada al modelo y un embedding por idea propuesta.
      </p>

      {queued && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Busqueda lanzada. Las propuestas apareceran aqui en cuanto el worker termine (unos segundos);
          la pagina se recarga sola.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
