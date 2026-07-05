import { createHash } from "node:crypto";
import type { StockClipRef, StockSearchRequest } from "@video-generator/types";
import { NotImplementedError, type StockFootageProvider } from "./types";

interface StoryblocksProviderOptions {
  apiKey: string;
  projectId: string;
  privateKey: string; // maps to STORYBLOCKS_API_KEY used as the HMAC secret; add STORYBLOCKS_PRIVATE_KEY to .env if activating
}

interface StoryblocksVideoHit {
  id: number;
  title: string;
  preview_urls?: { mp4_url?: string };
  metadata?: { duration_frames?: number; fps?: number };
}

/**
 * Paid premium footage via Storyblocks API, which signs every request with
 * HMAC-SHA256(privateKey, "resource-path" + expires). Search is implemented; download requires
 * a separate stock-item download-authorization call tied to the account's plan, left as
 * NotImplementedError until that commercial step is wired up.
 */
export class StoryblocksProvider implements StockFootageProvider {
  readonly name = "storyblocks";

  constructor(private readonly options: StoryblocksProviderOptions) {}

  private sign(resource: string, expires: number): string {
    return createHash("sha256")
      .update(this.options.privateKey + resource + expires)
      .digest("hex");
  }

  async search(req: StockSearchRequest): Promise<StockClipRef[]> {
    if (req.mediaType !== "video") {
      throw new NotImplementedError(this.name, "search(image)");
    }
    const resource = "/api/v2/videos/search";
    const expires = Math.floor(Date.now() / 1000) + 300;
    const hmac = this.sign(resource, expires);
    const query = req.keywords.join(" ");

    const url = `https://api.storyblocks.com${resource}?APIKEY=${this.options.apiKey}&PROJECT_ID=${this.options.projectId}&EXPIRES=${expires}&HMAC=${hmac}&keywords=${encodeURIComponent(query)}&results_per_page=${req.perPage ?? 10}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Storyblocks search failed: ${response.status}`);
    const data = (await response.json()) as { results: StoryblocksVideoHit[] };
    return data.results
      .filter((hit) => hit.preview_urls?.mp4_url)
      .map((hit) => ({
        id: String(hit.id),
        provider: this.name,
        mediaType: "video" as const,
        url: hit.preview_urls!.mp4_url!,
        width: 0,
        height: 0,
        durationSeconds:
          hit.metadata?.duration_frames && hit.metadata?.fps
            ? hit.metadata.duration_frames / hit.metadata.fps
            : undefined,
        attribution: "Licensed via Storyblocks",
      }));
  }

  async download(_clip: StockClipRef, _destPath: string): Promise<string> {
    throw new NotImplementedError(this.name, "download (requires a stock-item download authorization call)");
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resource = "/api/v2/videos/search";
      const expires = Math.floor(Date.now() / 1000) + 300;
      const hmac = this.sign(resource, expires);
      const response = await fetch(
        `https://api.storyblocks.com${resource}?APIKEY=${this.options.apiKey}&PROJECT_ID=${this.options.projectId}&EXPIRES=${expires}&HMAC=${hmac}&keywords=test&results_per_page=1`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
