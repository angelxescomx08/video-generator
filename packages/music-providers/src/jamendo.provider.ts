import type { MusicSearchRequest, MusicTrackRef } from "@video-generator/types";
import { downloadUrlTo } from "./download-util";
import type { MusicProvider } from "./types";

interface JamendoProviderOptions {
  clientId: string;
}

interface JamendoTrackHit {
  id: string;
  name: string;
  artist_name: string;
  audio: string;
  audiodownload: string;
  duration: number;
  shareurl: string;
  license_ccurl: string;
}

/** Royalty-free (Creative Commons) music search. Get a free client_id at https://developer.jamendo.com/ */
export class JamendoProvider implements MusicProvider {
  readonly name = "jamendo";

  constructor(private readonly options: JamendoProviderOptions) {}

  async search(req: MusicSearchRequest): Promise<MusicTrackRef[]> {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      format: "json",
      limit: String(req.perPage ?? 10),
      tags: req.tags.join("+"),
      include: "musicinfo",
      audioformat: "mp3",
      order: "popularity_total",
    });
    if (req.minDurationSeconds) {
      params.set("durationbetween", `${Math.round(req.minDurationSeconds)}_1200`);
    }

    const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`);
    if (!response.ok) throw new Error(`Jamendo search failed: ${response.status}`);
    const data = (await response.json()) as { results: JamendoTrackHit[] };
    return data.results
      .filter((hit) => hit.audiodownload || hit.audio)
      .map((hit) => ({
        id: hit.id,
        provider: this.name,
        title: hit.name,
        artist: hit.artist_name,
        url: hit.audiodownload || hit.audio,
        previewUrl: hit.shareurl,
        durationSeconds: hit.duration,
        licenseName: "Creative Commons",
        attribution: `"${hit.name}" by ${hit.artist_name} (Jamendo, ${hit.license_ccurl})`,
      }));
  }

  async download(track: MusicTrackRef, destPath: string): Promise<string> {
    return downloadUrlTo(track.url, destPath);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `https://api.jamendo.com/v3.0/tracks/?client_id=${this.options.clientId}&format=json&limit=1`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
