import { loadEnv } from "@video-generator/config";
import { db, providerConfigs } from "@video-generator/db";
import { and, eq } from "drizzle-orm";
import { AzureTTSProvider } from "./azure.provider";
import { CoquiProvider } from "./coqui.provider";
import { ElevenLabsProvider } from "./elevenlabs.provider";
import { PiperProvider } from "./piper.provider";
import type { TTSProvider } from "./types";

export type TTSProviderName = "piper" | "coqui" | "elevenlabs" | "azure";

function instantiate(name: TTSProviderName): TTSProvider {
  const env = loadEnv();
  switch (name) {
    case "piper":
      return new PiperProvider({ baseUrl: env.TTS_BASE_URL });
    case "coqui":
      return new CoquiProvider({ baseUrl: env.TTS_BASE_URL });
    case "elevenlabs":
      if (!env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set");
      return new ElevenLabsProvider({
        apiKey: env.ELEVENLABS_API_KEY,
        defaultVoiceId: env.ELEVENLABS_DEFAULT_VOICE_ID,
      });
    case "azure":
      if (!env.AZURE_TTS_KEY || !env.AZURE_TTS_REGION) throw new Error("AZURE_TTS_KEY/AZURE_TTS_REGION not set");
      return new AzureTTSProvider({ key: env.AZURE_TTS_KEY, region: env.AZURE_TTS_REGION });
  }
}

export async function resolveProvider(): Promise<TTSProvider> {
  const dbDefault = await db.query.providerConfigs.findFirst({
    where: and(eq(providerConfigs.providerType, "tts"), eq(providerConfigs.isDefault, true), eq(providerConfigs.isEnabled, true)),
  });

  const env = loadEnv();
  const name = (dbDefault?.providerName as TTSProviderName | undefined) ?? env.TTS_PROVIDER;
  return instantiate(name);
}
