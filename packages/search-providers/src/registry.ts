import { loadEnv } from "@video-generator/config";
import { db, providerConfigs } from "@video-generator/db";
import { and, eq } from "drizzle-orm";
import { BraveProvider } from "./brave.provider";
import { PlaywrightProvider } from "./playwright.provider";
import { SearxngProvider } from "./searxng.provider";
import { WikipediaProvider } from "./wikipedia.provider";
import { TavilyProvider } from "./tavily.provider";
import type { WebSearchProvider } from "./types";

export type SearchProviderName = "tavily" | "playwright" | "brave" | "wikipedia" | "searxng";

/**
 * Buscadores que se prueban solos cuando no hay ninguno elegido, en orden.
 *
 * El orden NO es por calidad de indice, es por lo que de verdad funciona — medido contra este
 * entorno, no supuesto:
 *
 * - `tavily` primero: capa gratuita real (1.000/mes, sin tarjeta), rapido y con el contenido ya
 *   limpio. Es lo unico que se recomienda si esto va a correr a menudo.
 * - `playwright` segundo: web abierta de verdad SIN cuenta ni API key, manejando un navegador real.
 *   Va por debajo de Tavily solo porque tarda segundos y depende del HTML de Bing, no porque busque
 *   peor. Es la mejor opcion para quien no quiere darse de alta en nada.
 * - `brave` tercero: buen indice propio, pero desde febrero de 2026 cobra desde la primera consulta.
 * - `wikipedia` ultimo: un solo sitio, que es justo lo que este paquete existe para evitar, pero
 *   responde siempre y sin nada instalado. Es la red que evita quedarse sin la funcion entera.
 *
 * `searxng` NO esta en esta lista y solo se usa si se elige explicitamente. No es por gusto: se
 * probo, y desde una IP domestica los motores upstream no bloquean, ENVENENAN — pedir "hallazgos
 * arqueologicos de la Biblia" devolvio foros de informatica y contenido NSFW de Reddit. La causa es
 * que pide las paginas con HTTP plano y se le nota; `playwright` resuelve exactamente eso usando un
 * navegador real contra el mismo buscador. En un servidor con IP limpia SearXNG vuelve a ser buena
 * opcion, y por eso sigue implementado.
 */
const AUTO_PREFERENCE: readonly SearchProviderName[] = ["tavily", "playwright", "brave", "wikipedia"];

/** Todos los nombres validos, para la UI de proveedores. */
export const SEARCH_PROVIDER_NAMES: readonly SearchProviderName[] = [
  "tavily",
  "playwright",
  "brave",
  "wikipedia",
  "searxng",
];

function instantiate(name: SearchProviderName): WebSearchProvider {
  const env = loadEnv();
  switch (name) {
    case "searxng":
      if (!env.SEARXNG_URL) throw new Error("SEARXNG_URL no esta configurada");
      return new SearxngProvider({ baseUrl: env.SEARXNG_URL });
    case "tavily":
      if (!env.TAVILY_API_KEY) throw new Error("TAVILY_API_KEY no esta configurada");
      return new TavilyProvider({ apiKey: env.TAVILY_API_KEY });
    case "brave":
      if (!env.BRAVE_API_KEY) throw new Error("BRAVE_API_KEY no esta configurada");
      return new BraveProvider({ apiKey: env.BRAVE_API_KEY });
    case "playwright":
      // No comprueba credenciales porque no tiene: lo que puede faltarle es un navegador, y eso se
      // sabe al lanzarlo, no al construirlo.
      return new PlaywrightProvider({ channel: env.PLAYWRIGHT_BROWSER_CHANNEL });
    case "wikipedia":
      // Sin credenciales que comprobar: por eso es el ultimo escalon que nunca falla.
      return new WikipediaProvider();
  }
}

/**
 * Elige el buscador: tabla `provider_configs` primero, env var despues, igual que el resto.
 *
 * La diferencia con los otros registries es el ultimo escalon: si no hay nada elegido, en vez de
 * fallar se prueba cada proveedor en orden de preferencia y se usa el primero que tenga
 * credenciales. El orden no es alfabetico — SearXNG va primero porque es el unico que no depende de
 * la politica de precios de nadie, y Brave ultimo porque desde 2026 cobra desde la primera consulta.
 *
 * Si no hay ninguno configurado, el error dice exactamente que hacer: es la diferencia entre "no se
 * pudo buscar" y saber que hay que levantar un contenedor o pegar una key.
 */
export async function resolveSearchProvider(): Promise<WebSearchProvider> {
  const [row] = await db
    .select({ providerName: providerConfigs.providerName })
    .from(providerConfigs)
    .where(
      and(
        eq(providerConfigs.providerType, "search"),
        eq(providerConfigs.isDefault, true),
        eq(providerConfigs.isEnabled, true),
      ),
    )
    .limit(1);

  const env = loadEnv();
  const chosen = (row?.providerName ?? env.SEARCH_PROVIDER) as SearchProviderName | undefined;
  if (chosen) return instantiate(chosen);

  const failures: string[] = [];
  for (const name of AUTO_PREFERENCE) {
    try {
      return instantiate(name);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }

  // Inalcanzable mientras wikipedia siga en AUTO_PREFERENCE (no necesita credenciales), pero se deja
  // por si alguien la quita: es mejor un error que explique que hacer que un undefined.
  throw new Error(
    "No hay ningun buscador disponible. Pon TAVILY_API_KEY en el .env (1.000 busquedas/mes gratis, " +
      `sin tarjeta). Detalle: ${failures.join("; ")}`,
  );
}
