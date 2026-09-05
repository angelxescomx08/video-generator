import { hostOf, trimSnippet, type SearchRequest, type SearchResult, type WebSearchProvider } from "./types";

/**
 * Brave Search API.
 *
 * OJO con el costo: Brave retiro su capa gratuita en febrero de 2026 y paso a credito prepago con
 * tarjeta obligatoria (~1.000 consultas por los 5 USD de credito mensual). Sigue implementado
 * porque el indice es propio y bueno, pero no es la opcion por defecto justamente por eso — ver
 * `registry.ts`.
 */
export class BraveProvider implements WebSearchProvider {
  readonly name = "brave";

  constructor(private readonly options: { apiKey: string }) {}

  async search(req: SearchRequest): Promise<SearchResult[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", req.query);
    url.searchParams.set("count", String(req.limit ?? 10));
    if (req.language) url.searchParams.set("search_lang", req.language);

    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": this.options.apiKey },
    });
    if (!response.ok) {
      throw new Error(`Brave respondio ${response.status}: ${await response.text().catch(() => "")}`);
    }

    const data = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (data.web?.results ?? [])
      .filter((r) => r.url && r.title)
      .map((r) => ({
        title: r.title!,
        url: r.url!,
        // Brave marca los terminos coincidentes con <strong>; se limpia o el prompt se llena de HTML.
        snippet: trimSnippet((r.description ?? "").replace(/<[^>]+>/g, "")),
        source: hostOf(r.url!),
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.search({ query: "test", limit: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
