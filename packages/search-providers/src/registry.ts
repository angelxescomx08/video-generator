import { loadEnv } from "@video-generator/config";
import { db, providerConfigs } from "@video-generator/db";
import { and, eq } from "drizzle-orm";
import { BraveProvider } from "./brave.provider";
import { SearxngProvider } from "./searxng.provider";
import { WikipediaProvider } from "./wikipedia.provider";
import { TavilyProvider } from "./tavily.provider";
import type { WebSearchProvider } from "./types";

export type SearchProviderName = "tavily" | "brave" | "wikipedia" | "searxng";

/**
 * Buscadores que se prueban solos cuando no hay ninguno elegido, en orden.
 *
 * El orden NO es por calidad de indice, es por lo que de verdad funciona — medido contra este
 * entorno, no supuesto:
 *
 * - `tavily` primero: unico con capa gratuita real (1.000/mes, sin tarjeta) y respuestas limpias.
 * - `brave` segundo: buen indice propio, pero desde febrero de 2026 cobra desde la primera consulta.
 * - `wikipedia` ultimo: un solo sitio, que es justo lo que este paquete existe para evitar, pero es
 *   el unico que responde sin cuenta ni infraestructura. Sin el, un usuario sin API key se queda sin
 *   la funcion entera.
 *
 * `searxng` NO esta en esta lista y solo se usa si se elige explicitamente. No es por gusto: se
 * probo, y desde una IP domestica los motores upstream no solo bloquean, sino que devuelven
 * resultados SENUELO — pedir "hallazgos arqueologicos de la Biblia" contesto con foros de
 * informatica y con contenido NSFW de Reddit. Un buscador que responde basura es peor que uno que
 * falla, porque la basura llega al prompt sin que nada avise. En un servidor con IP limpia vuelve a
 * ser la mejor opcion, y por eso sigue implementado.
 */
const AUTO_PREFERENCE: readonly SearchProviderName[] = ["tavily", "brave", "wikipedia"];

/** Todos los nombres validos, para la UI de proveedores. */
export const SEARCH_PROVIDER_NAMES: readonly SearchProviderName[] = [
  "tavily",
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
