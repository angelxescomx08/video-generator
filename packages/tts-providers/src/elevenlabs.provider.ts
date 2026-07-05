import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TTSProvider, TTSSynthesisRequest, TTSSynthesisResult, TTSVoice } from "./types";

interface ElevenLabsProviderOptions {
  apiKey: string;
  defaultVoiceId?: string;
}

/** Paid, high-quality TTS. Ready to activate via TTS_PROVIDER=elevenlabs + ELEVENLABS_API_KEY. */
export class ElevenLabsProvider implements TTSProvider {
  readonly name = "elevenlabs";

  constructor(private readonly options: ElevenLabsProviderOptions) {}

  async listVoices(): Promise<TTSVoice[]> {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": this.options.apiKey },
    });
    if (!response.ok) throw new Error(`ElevenLabs /voices failed: ${response.status}`);
    const data = (await response.json()) as { voices: { voice_id: string; name: string }[] };
    return data.voices.map((v) => ({ id: v.voice_id, label: v.name, language: "multi" }));
  }

  async synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    const voiceId = req.voiceId ?? this.options.defaultVoiceId;
    if (!voiceId) throw new Error("ElevenLabs requires a voiceId (none provided and no default configured)");

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.options.apiKey,
      },
      body: JSON.stringify({
        text: req.text,
        model_id: "eleven_multilingual_v2",
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs synthesize failed: ${response.status} ${await response.text()}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const destPath = req.destPath ?? path.join(tmpdir(), `elevenlabs-${randomUUID()}.mp3`);
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, audioBuffer);

    // ElevenLabs doesn't return duration directly; worker estimates/derives it via ffprobe downstream.
    return { audioFilePath: destPath, durationSeconds: 0 };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": this.options.apiKey },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
