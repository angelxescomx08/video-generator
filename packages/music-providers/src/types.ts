import type { MusicSearchRequest, MusicTrackRef } from "@video-generator/types";

export class NotImplementedError extends Error {
  constructor(providerName: string, method: string) {
    super(`${providerName} does not implement ${method} yet`);
    this.name = "NotImplementedError";
  }
}

export interface MusicProvider {
  readonly name: string;
  search(req: MusicSearchRequest): Promise<MusicTrackRef[]>;
  download(track: MusicTrackRef, destPath: string): Promise<string>;
  healthCheck(): Promise<boolean>;
}

export type { MusicSearchRequest, MusicTrackRef };
