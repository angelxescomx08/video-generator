import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWavDurationSeconds } from "./wav-utils";
import type { TTSProvider, TTSSynthesisRequest, TTSSynthesisResult, TTSVoice } from "./types";

interface CoquiProviderOptions {
  baseUrl: string; // e.g. http://localhost:5002 running `tts-server` from coqui-ai/TTS
}

/** Alternative free/local TTS engine. Same shape as Piper — swap TTS_PROVIDER=coqui to use it. */
export class CoquiProvider implements TTSProvider {
  readonly name = "coqui";

  constructor(private readonly options: CoquiProviderOptions) {}

  async listVoices(): Promise<TTSVoice[]> {
    const response = await fetch(`${this.options.baseUrl}/speakers`);
    if (!response.ok) return [];
    const speakers = (await response.json()) as string[];
    return speakers.map((id) => ({ id, label: id, language: "en" }));
  }

  async synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    const url = new URL(`${this.options.baseUrl}/api/tts`);
    url.searchParams.set("text", req.text);
    if (req.voiceId) url.searchParams.set("speaker_id", req.voiceId);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Coqui /api/tts failed: ${response.status} ${await response.text()}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const destPath = req.destPath ?? path.join(tmpdir(), `coqui-${randomUUID()}.wav`);
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, audioBuffer);

    return {
      audioFilePath: destPath,
      durationSeconds: readWavDurationSeconds(audioBuffer),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(this.options.baseUrl);
      return response.ok;
    } catch {
      return false;
    }
  }
}
