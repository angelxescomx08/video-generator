import { loadEnv } from "@video-generator/config";
import { db, providerConfigs } from "@video-generator/db";
import { and, eq } from "drizzle-orm";
import { JamendoProvider } from "./jamendo.provider";
import type { MusicProvider } from "./types";

export type MusicProviderName = "jamendo";

function instantiate(name: MusicProviderName): MusicProvider {
  const env = loadEnv();
  switch (name) {
    case "jamendo":
      if (!env.JAMENDO_CLIENT_ID) throw new Error("JAMENDO_CLIENT_ID is not set");
      return new JamendoProvider({ clientId: env.JAMENDO_CLIENT_ID });
  }
}

/** Single explicit provider. */
export async function resolveProvider(name: MusicProviderName): Promise<MusicProvider> {
  return instantiate(name);
}

/**
 * Default music provider (table `provider_configs`, provider_type='music', first; env fallback).
 * Returns null instead of throwing when nothing is configured — background music is optional
 * (unlike TTS/stock footage), so a missing provider must not fail video generation.
 */
export async function resolveMusicProvider(): Promise<MusicProvider | null> {
  const dbDefault = await db.query.providerConfigs.findFirst({
    where: and(
      eq(providerConfigs.providerType, "music"),
      eq(providerConfigs.isDefault, true),
      eq(providerConfigs.isEnabled, true),
    ),
  });

  const env = loadEnv();
  const name = (dbDefault?.providerName as MusicProviderName | undefined) ?? (env.JAMENDO_CLIENT_ID ? "jamendo" : undefined);
  if (!name) return null;

  try {
    return instantiate(name);
  } catch {
    return null;
  }
}
