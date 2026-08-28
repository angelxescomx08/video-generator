import type { ProviderCost } from "@video-generator/types";

/** Piper/Coqui corren self-hosted via TTS_BASE_URL (docker/piper, docker/coqui) — siempre gratis. */
export function localTtsCost(providerName: string, voiceName?: string, charCount?: number): ProviderCost {
  return {
    providerType: "tts",
    providerName,
    model: voiceName,
    isFree: true,
    isLocal: true,
    amountUsd: 0,
    units: charCount,
    unitKind: charCount === undefined ? undefined : "chars",
  };
}

/**
 * $0.10 por 1,000 caracteres (Multilingual v2/v3). Verificado 2026-08-23, sin cambios.
 * Los modelos Flash/Turbo cuestan la mitad ($0.05/1k) — si se llega a permitir elegir modelo en el
 * provider, hay que distinguirlos aqui como se hace con las familias de voz de Google.
 */
const ELEVENLABS_USD_PER_CHAR = 0.1 / 1000;

export function elevenLabsCost(charCount: number, voiceName?: string): ProviderCost {
  return {
    providerType: "tts",
    providerName: "elevenlabs",
    model: voiceName,
    isFree: false,
    isLocal: false,
    amountUsd: charCount * ELEVENLABS_USD_PER_CHAR,
    units: charCount,
    unitKind: "chars",
    detail: `${charCount} caracteres`,
  };
}

/**
 * $16 por 1,000,000 caracteres (voces Neural prefabricadas). Verificado 2026-08-23, sin cambios.
 * Las voces Neural HD son mas caras ($22/1M); el provider no las distingue todavia.
 */
const AZURE_USD_PER_CHAR = 16 / 1_000_000;

export function azureTtsCost(charCount: number, voiceName?: string): ProviderCost {
  return {
    providerType: "tts",
    providerName: "azure",
    model: voiceName,
    isFree: false,
    isLocal: false,
    amountUsd: charCount * AZURE_USD_PER_CHAR,
    units: charCount,
    unitKind: "chars",
    detail: `${charCount} caracteres`,
  };
}

/**
 * Google Cloud Text-to-Speech cobra distinto segun la familia de voz (por 1M caracteres):
 * Standard $4, WaveNet $4, Neural2 $16, Chirp3 HD $30. Verificado 2026-08-23, sin cambios.
 * El nombre de la voz (ej. "es-US-Neural2-A") trae la familia embebida, se detecta por substring.
 *
 * NOTA: este calculo ignora la capa gratuita mensual de Google (4M caracteres Standard y 1M para
 * cada una de Neural2 / Studio / Chirp3 HD), asi que para volumenes bajos el costo REAL facturado
 * es $0 y lo que se reporta aqui es el costo marginal una vez agotada esa cuota.
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
    model: voiceName,
    isFree: false,
    isLocal: false,
    amountUsd: charCount * googleUsdPerChar(voiceName),
    units: charCount,
    unitKind: "chars",
    detail: `${charCount} caracteres (${voiceName})`,
  };
}
