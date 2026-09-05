import { hostOf, trimSnippet, type SearchRequest, type SearchResult, type WebSearchProvider } from "./types";

/**
 * SearXNG: metabuscador autohospedado que agrega resultados de Google, Bing, DuckDuckGo y otros.
 *
 * Es el proveedor por defecto porque no necesita NINGUNA API key ni darse de alta en nada: se
 * levanta como un contenedor mas junto a postgres/ollama/tts (`pnpm docker:up:deps`). Eso importa
 * mas de lo que parece — Brave elimino su capa gratuita en febrero de 2026 y ahora exige tarjeta,
 * asi que la unica forma de tener busqueda web abierta sin depender de la politica de precios de un
 * tercero es autohospedarla.
 *
 * A cambio hay que saber dos cosas: SearXNG solo devuelve JSON si su `settings.yml` incluye `json`
 * en `search.formats` (el nuestro lo hace, ver docker/searxng), y los motores upstream pueden
 * bloquearlo temporalmente si se le pide demasiado seguido. Por eso el error distingue el caso de
 * "no hay formato JSON" del de "no responde": son arreglos distintos.
 */
export class SearxngProvider implements WebSearchProvider {
  readonly name = "searxng";

  constructor(private readonly options: { baseUrl: string }) {}

  async search(req: SearchRequest): Promise<SearchResult[]> {
    const url = new URL("/search", this.options.baseUrl);
    url.searchParams.set("q", req.query);
    url.searchParams.set("format", "json");
    // `general` mantiene fuera imagenes y videos, que no aportan nada a una propuesta de tema.
    url.searchParams.set("categories", "general");
    if (req.language) url.searchParams.set("language", req.language);

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      const hint =
        response.status === 403
          ? ' — revisa que "json" este en `search.formats` del settings.yml de SearXNG'
          : "";
      throw new Error(`SearXNG respondio ${response.status}${hint}`);
    }

    const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results ?? [])
      .filter((r) => r.url && r.title)
      .slice(0, req.limit ?? 10)
      .map((r) => ({
        title: r.title!,
        url: r.url!,
        snippet: trimSnippet(r.content ?? ""),
        source: hostOf(r.url!),
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(new URL("/healthz", this.options.baseUrl));
      return response.ok;
    } catch {
      return false;
    }
  }
}
