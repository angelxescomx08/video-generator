import { loadEnv } from "@video-generator/config";
import { db, providerConfigs } from "@video-generator/db";
import { and, eq } from "drizzle-orm";
import { isMonetizationSafe, STOCK_LICENSES } from "./licensing";
import { PexelsProvider } from "./pexels.provider";
import { PixabayProvider } from "./pixabay.provider";
import { ShutterstockProvider } from "./shutterstock.provider";
import { StoryblocksProvider } from "./storyblocks.provider";
import type { StockFootageProvider } from "./types";

export type StockProviderName = "pixabay" | "pexels" | "shutterstock" | "storyblocks";

function instantiate(name: StockProviderName): StockFootageProvider {
  const env = loadEnv();
  switch (name) {
    case "pixabay":
      if (!env.PIXABAY_API_KEY) throw new Error("PIXABAY_API_KEY is not set");
      return new PixabayProvider({ apiKey: env.PIXABAY_API_KEY });
    case "pexels":
      if (!env.PEXELS_API_KEY) throw new Error("PEXELS_API_KEY is not set");
      return new PexelsProvider({ apiKey: env.PEXELS_API_KEY });
    case "shutterstock":
      if (!env.SHUTTERSTOCK_API_KEY || !env.SHUTTERSTOCK_API_SECRET) {
        throw new Error("SHUTTERSTOCK_API_KEY/SHUTTERSTOCK_API_SECRET not set");
      }
      return new ShutterstockProvider({
        apiKey: env.SHUTTERSTOCK_API_KEY,
        apiSecret: env.SHUTTERSTOCK_API_SECRET,
      });
    case "storyblocks":
      if (!env.STORYBLOCKS_API_KEY || !env.STORYBLOCKS_PROJECT_ID || !env.STORYBLOCKS_PRIVATE_KEY) {
        throw new Error("STORYBLOCKS_API_KEY/STORYBLOCKS_PROJECT_ID/STORYBLOCKS_PRIVATE_KEY not set");
      }
      return new StoryblocksProvider({
        apiKey: env.STORYBLOCKS_API_KEY,
        projectId: env.STORYBLOCKS_PROJECT_ID,
        privateKey: env.STORYBLOCKS_PRIVATE_KEY,
      });
  }
}

/** Single explicit provider (e.g. "premium only" mode using Shutterstock/Storyblocks). */
export async function resolveProvider(name: StockProviderName): Promise<StockFootageProvider> {
  return instantiate(name);
}

/**
 * Todos los proveedores de stock habilitados a la vez (por defecto Pixabay + Pexels juntos, para
 * tener variedad de material). Se habilitan/deshabilitan en la tabla `provider_configs`
 * (provider_type='stock'), y se pueden combinar libremente.
 *
 * Dos filtros deliberados, en este orden:
 *
 * 1. **Licencia**: se descarta cualquier proveedor que no sea seguro para monetizar (ver
 *    licensing.ts). Shutterstock/Storyblocks exigen comprar licencia por clip o suscripcion, y
 *    este repo no implementa esa compra — dejarlos entrar meteria material no monetizable.
 * 2. **Credenciales**: si a un proveedor le falta su API key se salta con un aviso, en vez de
 *    tumbar la generacion. Asi habilitar dos proveedores y tener la key de solo uno sigue
 *    produciendo video.
 */
export async function resolveStockProviders(): Promise<StockFootageProvider[]> {
  const enabledRows = await db.query.providerConfigs.findMany({
    where: and(eq(providerConfigs.providerType, "stock"), eq(providerConfigs.isEnabled, true)),
  });

  const requested: StockProviderName[] =
    enabledRows.length > 0
      ? (enabledRows.map((r) => r.providerName) as StockProviderName[])
      : ["pixabay", "pexels"];

  const providers: StockFootageProvider[] = [];
  for (const name of requested) {
    if (!isMonetizationSafe(name)) {
      console.warn(
        `Stock provider "${name}" omitido: ${STOCK_LICENSES[name]?.notes ?? "licencia no apta para monetizar"}`,
      );
      continue;
    }
    try {
      providers.push(instantiate(name));
    } catch (err) {
      console.warn(`Skipping stock provider "${name}": ${(err as Error).message}`);
    }
  }
  return providers;
}
