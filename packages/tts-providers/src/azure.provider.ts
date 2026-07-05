import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TTSProvider, TTSSynthesisRequest, TTSSynthesisResult, TTSVoice } from "./types";

interface AzureTTSProviderOptions {
  key: string;
  region: string;
}

/** Paid TTS via Azure Cognitive Services Speech. Activate via TTS_PROVIDER=azure + AZURE_TTS_KEY/REGION. */
export class AzureTTSProvider implements TTSProvider {
  readonly name = "azure";

  constructor(private readonly options: AzureTTSProviderOptions) {}

  async listVoices(): Promise<TTSVoice[]> {
    const response = await fetch(
      `https://${this.options.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
      { headers: { "Ocp-Apim-Subscription-Key": this.options.key } },
    );
    if (!response.ok) throw new Error(`Azure voices list failed: ${response.status}`);
    const data = (await response.json()) as { ShortName: string; DisplayName: string; Locale: string }[];
    return data.map((v) => ({ id: v.ShortName, label: v.DisplayName, language: v.Locale }));
  }

  async synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    const voice = req.voiceId ?? "en-US-JennyNeural";
    const ssml = `<speak version='1.0' xml:lang='${req.languageCode ?? "en-US"}'>
      <voice name='${voice}'>${req.text}</voice>
    </speak>`;

    const response = await fetch(
      `https://${this.options.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.options.key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        },
        body: ssml,
      },
    );

    if (!response.ok) {
      throw new Error(`Azure synthesize failed: ${response.status} ${await response.text()}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const destPath = req.destPath ?? path.join(tmpdir(), `azure-${randomUUID()}.wav`);
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, audioBuffer);

    return { audioFilePath: destPath, durationSeconds: 0 };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `https://${this.options.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
        { headers: { "Ocp-Apim-Subscription-Key": this.options.key } },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
