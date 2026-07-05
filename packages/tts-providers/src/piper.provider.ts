import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWavDurationSeconds } from "./wav-utils";
import type { TTSProvider, TTSSynthesisRequest, TTSSynthesisResult, TTSVoice } from "./types";

interface PiperProviderOptions {
  baseUrl: string;
}

/** Free, local, offline TTS via the docker/piper HTTP wrapper (see docker-compose `tts` service). */
export class PiperProvider implements TTSProvider {
  readonly name = "piper";

  constructor(private readonly options: PiperProviderOptions) {}

  async listVoices(): Promise<TTSVoice[]> {
    const response = await fetch(`${this.options.baseUrl}/voices`);
    if (!response.ok) throw new Error(`Piper /voices failed: ${response.status}`);
    return (await response.json()) as TTSVoice[];
  }

  async synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    const response = await fetch(`${this.options.baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: req.text, voiceId: req.voiceId }),
    });

    if (!response.ok) {
      throw new Error(`Piper /synthesize failed: ${response.status} ${await response.text()}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const destPath = req.destPath ?? path.join(tmpdir(), `piper-${randomUUID()}.wav`);
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, audioBuffer);

    return {
      audioFilePath: destPath,
      durationSeconds: readWavDurationSeconds(audioBuffer),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.options.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
