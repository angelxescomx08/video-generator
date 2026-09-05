import { hostOf, trimSnippet, type SearchRequest, type SearchResult, type WebSearchProvider } from "./types";

/**
 * Tavily: buscador pensado para alimentar LLMs.
 *
 * Se diferencia de un buscador normal en que devuelve el CONTENIDO relevante de cada pagina ya
 * extraido, no solo el titulo y un fragmento de meta description. Para proponer temas eso vale
 * bastante: el modelo lee sustancia en vez de anzuelos de SEO.
 *
 * Es la alternativa recomendada si no se quiere levantar un contenedor: tiene capa gratuita real de
 * 1.000 busquedas al mes y no pide tarjeta, que a dia de hoy es algo que casi ningun buscador con
 * API mantiene.
 */
export class TavilyProvider implements WebSearchProvider {
  readonly name = "tavily";

  constructor(private readonly options: { apiKey: string }) {}

  async search(req: SearchRequest): Promise<SearchResult[]> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({
        query: req.query,
        // `basic` gasta 1 credito por busqueda y `advanced` gasta 2. Con 1.000 al mes, la diferencia
        // decide si esto se puede usar a diario o no, y para proponer temas basic alcanza.
        search_depth: "basic",
        max_results: req.limit ?? 10,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily respondio ${response.status}: ${await response.text().catch(() => "")}`);
    }

    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? [])
      .filter((r) => r.url && r.title)
      .map((r) => ({
        title: r.title!,
        url: r.url!,
        snippet: trimSnippet(r.content ?? ""),
        source: hostOf(r.url!),
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const results = await this.search({ query: "test", limit: 1 });
      return results.length >= 0;
    } catch {
      return false;
    }
  }
}
