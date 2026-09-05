import { trimSnippet, type SearchRequest, type SearchResult, type WebSearchProvider } from "./types";

/**
 * Busqueda en Wikipedia via su API oficial.
 *
 * Es el ULTIMO recurso de la cadena, no la opcion preferida: buscar en un solo sitio es exactamente
 * lo que este paquete existe para evitar. Esta aqui porque es el unico buscador que funciona sin
 * cuenta, sin tarjeta y sin infraestructura, y sin el la funcion entera queda muerta hasta que
 * alguien se de de alta en algo.
 *
 * Lo que se pierde usandolo: nada de actualidad, nada de blogs ni de divulgacion, y un sesgo fuerte
 * hacia lo enciclopedico. Lo que se gana: responde siempre, no envenena resultados y sobre temas
 * historicos o biblicos el material es denso y verificable. Para proponer temas de video eso da
 * ideas correctas pero poco sorprendentes — sube a Tavily en cuanto puedas.
 *
 * A diferencia de un buscador que raspa, esta es la API publica y documentada de Wikimedia: no hay
 * CAPTCHA ni bloqueo por IP, solo se pide identificarse con un User-Agent.
 */
export class WikipediaProvider implements WebSearchProvider {
  readonly name = "wikipedia";

  constructor(private readonly options: { language?: string } = {}) {}

  async search(req: SearchRequest): Promise<SearchResult[]> {
    const lang = req.language ?? this.options.language ?? "es";
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", req.query);
    url.searchParams.set("srlimit", String(req.limit ?? 10));
    // `snippet` viene con <span class="searchmatch"> alrededor de los terminos; se limpia abajo.
    url.searchParams.set("srprop", "snippet");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");

    const response = await fetch(url, {
      headers: { "User-Agent": "video-generator/0.1 (topic research)" },
    });
    if (!response.ok) throw new Error(`Wikipedia respondio ${response.status}`);

    const data = (await response.json()) as {
      query?: { search?: Array<{ title?: string; pageid?: number; snippet?: string }> };
    };

    return (data.query?.search ?? [])
      .filter((r) => r.title && r.pageid)
      .map((r) => ({
        title: r.title!,
        url: `https://${lang}.wikipedia.org/?curid=${r.pageid}`,
        snippet: trimSnippet((r.snippet ?? "").replace(/<[^>]+>/g, "")),
        source: `${lang}.wikipedia.org`,
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const results = await this.search({ query: "Biblia", limit: 1 });
      return results.length > 0;
    } catch {
      return false;
    }
  }
}
