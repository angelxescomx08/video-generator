import type { ProviderCost } from "@video-generator/types";

/** Piper/Coqui corren self-hosted via TTS_BASE_URL (docker/piper, docker/coqui) — siempre gratis. */
export function localTtsCost(providerName: string): ProviderCost {
  return { providerType: "tts", providerName, isFree: true, isLocal: true, amountUsd: 0 };
}

/** $0.10 por 1,000 caracteres (Multilingual v2, precio investigado agosto 2026). */
const ELEVENLABS_USD_PER_CHAR = 0.1 / 1000;

export function elevenLabsCost(charCount: number): ProviderCost {
  return {
    providerType: "tts",
    providerName: "elevenlabs",
    isFree: false,
    isLocal: false,
    amountUsd: charCount * ELEVENLABS_USD_PER_CHAR,
    detail: `${charCount} caracteres`,
  };
}

/** $16 por 1,000,000 caracteres (voces Neural, precio investigado agosto 2026). */
const AZURE_USD_PER_CHAR = 16 / 1_000_000;

export function azureTtsCost(charCount: number): ProviderCost {
  return {
    providerType: "tts",
    providerName: "azure",
    isFree: false,
    isLocal: false,
    amountUsd: charCount * AZURE_USD_PER_CHAR,
    detail: `${charCount} caracteres`,
  };
}

/**
 * Google Cloud Text-to-Speech cobra distinto segun la familia de voz (precios investigados
 * agosto 2026, por 1M caracteres): WaveNet $4, Neural2 $16, Chirp3 HD $30. El nombre de la voz
 * (ej. "es-US-Neural2-A") trae la familia embebida, se detecta por substring.
 */
function googleUsdPerChar(voiceName: string): number {
  const name = voiceName.toLowerCase();
  if (name.includes("chirp")) return 30 / 1_000_000;
  if (name.includes("neural2")) return 16 / 1_000_000;
  if (name.includes("wavenet")) return 4 / 1_000_000;
  return 4 / 1_000_000; // Standard u otra familia no reconocida, misma tarifa que WaveNet.
}

export function googleTtsCost(voiceName: string, charCount: number): ProviderCost {
  return {
    providerType: "tts",
    providerName: "google",
    isFree: false,
    isLocal: false,
    amountUsd: charCount * googleUsdPerChar(voiceName),
    detail: `${charCount} caracteres (${voiceName})`,
  };
}
