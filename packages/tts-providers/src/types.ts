export interface TTSSynthesisRequest {
  text: string;
  voiceId?: string;
  languageCode?: string;
  speakingRate?: number;
  outputFormat?: "wav" | "mp3";
  /** Where to write the resulting audio file. Defaults to a file under os.tmpdir() if omitted. */
  destPath?: string;
}

export interface WordTiming {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TTSSynthesisResult {
  audioFilePath: string;
  durationSeconds: number;
  wordTimings?: WordTiming[];
}

export interface TTSVoice {
  id: string;
  label: string;
  language: string;
}

export class NotImplementedError extends Error {
  constructor(providerName: string, method: string) {
    super(`${providerName} does not implement ${method} yet`);
    this.name = "NotImplementedError";
  }
}

export interface TTSProvider {
  readonly name: string;
  listVoices(): Promise<TTSVoice[]>;
  synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult>;
  healthCheck(): Promise<boolean>;
}
