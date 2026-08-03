import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { googleTtsCost } from "./pricing";
import type { TTSProvider, TTSSynthesisRequest, TTSSynthesisResult, TTSVoice } from "./types";

interface GoogleTTSProviderOptions {
  apiKey: string;
  voiceName: string;
  languageCode: string;
}

interface GoogleVoiceEntry {
  name: string;
  languageCodes: string[];
}

/**
 * Paid TTS via Google Cloud Text-to-Speech REST API. Activate via TTS_PROVIDER=google +
 * GOOGLE_TTS_API_KEY (una API key de un proyecto de GCP con la API "Cloud Text-to-Speech"
 * habilitada — no requiere cuenta de servicio, igual que GOOGLE_GEMINI_API_KEY).
 */
export class GoogleTTSProvider implements TTSProvider {
  readonly name = "google";

  constructor(private readonly options: GoogleTTSProviderOptions) {}

  async listVoices(): Promise<TTSVoice[]> {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/voices?key=${this.options.apiKey}&languageCode=${this.options.languageCode}`,
    );
    if (!response.ok) throw new Error(`Google TTS /voices failed: ${response.status}`);
    const data = (await response.json()) as { voices: GoogleVoiceEntry[] };
    return data.voices.map((v) => ({ id: v.name, label: v.name, language: v.languageCodes[0] ?? this.options.languageCode }));
  }

  async synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    const voiceName = req.voiceId ?? this.options.voiceName;
    const languageCode = req.languageCode ?? this.options.languageCode;

    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.options.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: req.text },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: "MP3", speakingRate: req.speakingRate },
      }),
    });

    if (!response.ok) {
      throw new Error(`Google TTS synthesize failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { audioContent: string };
    const audioBuffer = Buffer.from(data.audioContent, "base64");
    const destPath = req.destPath ?? path.join(tmpdir(), `google-tts-${randomUUID()}.mp3`);
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, audioBuffer);

    // Google no regresa duracion; el worker la deriva via ffprobe downstream (mismo patron que ElevenLabs/Azure).
    return { audioFilePath: destPath, durationSeconds: 0, cost: googleTtsCost(voiceName, req.text.length) };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${this.options.apiKey}`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
