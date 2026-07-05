import type { StockClipRef, StockSearchRequest } from "@video-generator/types";
import { NotImplementedError, type StockFootageProvider } from "./types";

interface ShutterstockProviderOptions {
  apiKey: string;
  apiSecret: string;
}

interface ShutterstockVideoHit {
  id: string;
  description: string;
  duration: number;
  assets: { preview_mp4?: { url: string; width?: number; height?: number } };
}

/**
 * Paid premium footage. Search works with API key/secret (Basic Auth); downloading a full-res
 * asset requires purchasing a license first via a separate Shutterstock licensing API call,
 * which needs an account with billing configured — left as NotImplementedError until that
 * commercial step is wired up. Activate search via STOCK provider_configs enabling "shutterstock".
 */
export class ShutterstockProvider implements StockFootageProvider {
  readonly name = "shutterstock";

  constructor(private readonly options: ShutterstockProviderOptions) {}

  private authHeader(): string {
    const token = Buffer.from(`${this.options.apiKey}:${this.options.apiSecret}`).toString("base64");
    return `Basic ${token}`;
  }

  async search(req: StockSearchRequest): Promise<StockClipRef[]> {
    if (req.mediaType !== "video") {
      throw new NotImplementedError(this.name, "search(image)");
    }
    const query = req.keywords.join(" ");
    const response = await fetch(
      `https://api.shutterstock.com/v2/videos/search?query=${encodeURIComponent(query)}&per_page=${req.perPage ?? 10}`,
      { headers: { Authorization: this.authHeader() } },
    );
    if (!response.ok) throw new Error(`Shutterstock search failed: ${response.status}`);
    const data = (await response.json()) as { data: ShutterstockVideoHit[] };
    return data.data
      .filter((hit) => hit.assets.preview_mp4?.url)
      .map((hit) => ({
        id: hit.id,
        provider: this.name,
        mediaType: "video" as const,
        url: hit.assets.preview_mp4!.url,
        width: hit.assets.preview_mp4!.width ?? 0,
        height: hit.assets.preview_mp4!.height ?? 0,
        durationSeconds: hit.duration,
        attribution: "Licensed via Shutterstock",
      }));
  }

  async download(_clip: StockClipRef, _destPath: string): Promise<string> {
    throw new NotImplementedError(this.name, "download (requires purchasing a license first)");
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch("https://api.shutterstock.com/v2/videos/search?query=test&per_page=1", {
        headers: { Authorization: this.authHeader() },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
