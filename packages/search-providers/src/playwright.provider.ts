import { hostOf, trimSnippet, type SearchRequest, type SearchResult, type WebSearchProvider } from "./types";

/**
 * Busqueda en la web abierta manejando un NAVEGADOR REAL con Playwright.
 *
 * Es la respuesta a por que SearXNG no sirvio. SearXNG pide las paginas con peticiones HTTP planas:
 * sin motor de JS, sin huella TLS de navegador, sin cookies. Los buscadores lo detectan al instante y
 * no solo bloquean — devuelven resultados SENUELO, que es peor, porque la basura llega al prompt sin
 * que nada avise. Aqui la peticion sale de un Chromium/Edge de verdad, con su huella real, asi que el
 * buscador no tiene como distinguirla de una persona. Comprobado contra este mismo entorno: la misma
 * consulta que a SearXNG le devolvia foros de informatica, aqui devuelve National Geographic.
 *
 * El precio de esto, con los ojos abiertos:
 * - **Lento.** Levantar el navegador y cargar la pagina son varios segundos, contra ~300ms de una API.
 *   Da igual para proponer temas (se hace a mano, un par de veces al dia); seria inaceptable dentro
 *   del pipeline de render.
 * - **Fragil.** Depende del HTML de Bing. El dia que cambien `li.b_algo`, esto devuelve cero
 *   resultados — no un error. Por eso `search` lanza si no encuentra el selector en vez de devolver
 *   una lista vacia: un fallo ruidoso se arregla, uno silencioso se convierte en "la IA ya no propone
 *   nada bueno" tres semanas despues.
 * - **Raspado.** Leer resultados de un buscador con un bot va contra sus condiciones de uso. Con este
 *   volumen (unas pocas consultas al dia, a mano) es la practica habitual, pero conviene saberlo
 *   antes de automatizarlo a lo grande.
 *
 * Se usa Bing y no Google ni DuckDuckGo por medicion, no por preferencia: Google es el mas agresivo
 * contra automatizacion, DuckDuckGo aborto la conexion y Brave devolvio CAPTCHA hasta con navegador
 * real. Bing respondio 10 resultados relevantes de forma consistente.
 */

/** Cuanto se espera a que aparezcan los resultados antes de dar la busqueda por rota. */
const SELECTOR_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 25_000;

/**
 * Canales de navegador que se prueban, en orden.
 *
 * Edge y Chrome primero porque en Windows ya estan instalados: usarlos hace que esto funcione sin
 * descargar nada. `undefined` es el Chromium que trae Playwright, que si hay que bajar con
 * `npx playwright install chromium` — es el unico camino dentro del contenedor del worker, donde no
 * hay ningun navegador del sistema.
 */
const CHANNEL_FALLBACKS = ["msedge", "chrome", undefined] as const;

export class PlaywrightProvider implements WebSearchProvider {
  readonly name = "playwright";

  constructor(private readonly options: { channel?: string } = {}) {}

  async search(req: SearchRequest): Promise<SearchResult[]> {
    // Import dinamico: playwright pesa y solo hace falta si este provider se usa de verdad. Asi el
    // paquete se puede instalar y typechequear sin arrastrar un navegador a quien no lo quiere.
    const { chromium } = await import("playwright");

    const channels = this.options.channel ? [this.options.channel] : CHANNEL_FALLBACKS;
    let lastError: Error | null = null;

    for (const channel of channels) {
      let browser;
      try {
        browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
      } catch (err) {
        // Este canal no esta instalado; se prueba el siguiente en vez de fallar la busqueda entera.
        lastError = err as Error;
        continue;
      }

      try {
        return await this.scrapeBing(browser, req);
      } finally {
        await browser.close().catch(() => {});
      }
    }

    throw new Error(
      "No se encontro ningun navegador para buscar. Instala Edge o Chrome, o ejecuta " +
        `"npx playwright install chromium". Detalle: ${lastError?.message ?? "sin detalle"}`,
    );
  }

  private async scrapeBing(browser: import("playwright").Browser, req: SearchRequest): Promise<SearchResult[]> {
    const page = await browser.newPage({ locale: req.language === "en" ? "en-US" : "es-ES" });
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(req.query)}`, {
      waitUntil: "domcontentloaded",
    });
    // Lanza si no aparece: ver la nota sobre fallos ruidosos en el docstring de la clase.
    await page.waitForSelector("li.b_algo", { timeout: SELECTOR_TIMEOUT_MS });

    const raw = await page.$$eval("li.b_algo", (nodes) =>
      nodes.map((node) => ({
        title: (node.querySelector("h2")?.textContent ?? "").trim(),
        href: node.querySelector("h2 a")?.getAttribute("href") ?? "",
        snippet: (node.querySelector(".b_caption p, .b_algoSlug")?.textContent ?? "").trim(),
      })),
    );

    return raw
      .map((r) => ({ ...r, url: resolveBingUrl(r.href) }))
      .filter((r) => r.title && r.url.startsWith("http"))
      .slice(0, req.limit ?? 10)
      .map((r) => ({
        title: r.title,
        url: r.url,
        snippet: trimSnippet(r.snippet),
        source: hostOf(r.url),
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      return (await this.search({ query: "test", limit: 1 })).length > 0;
    } catch {
      return false;
    }
  }
}

/**
 * Bing no enlaza al sitio: enlaza a un redirect suyo que lleva la URL real en el parametro `u`,
 * en base64url con un prefijo "a1".
 *
 * Sin deshacer eso, todas las fuentes de una propuesta quedarian como "bing.com" y el usuario no
 * podria ni ver de donde salio ni verificarla, que es justo para lo que se guardan.
 */
function resolveBingUrl(href: string): string {
  const match = href.match(/[?&]u=a1([^&]+)/);
  if (!match) return href;
  try {
    return Buffer.from(match[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return href;
  }
}
