import type { StockClipRef, StockSearchRequest } from "@video-generator/types";
import { downloadUrlTo } from "./download-util";
import type { StockFootageProvider } from "./types";

interface PixabayProviderOptions {
  apiKey: string;
}

interface PixabayVideoHit {
  id: number;
  tags: string;
  pageURL: string;
  videos: {
    large: { url: string; width: number; height: number };
    medium: { url: string; width: number; height: number };
  };
  duration: number;
}

interface PixabayImageHit {
  id: number;
  tags: string;
  pageURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
}

function matchesOrientation(width: number, height: number, orientation?: string): boolean {
  if (!orientation) return true;
  if (orientation === "portrait") return height > width;
  if (orientation === "landscape") return width > height;
  return Math.abs(width - height) < Math.min(width, height) * 0.1;
}

/** Free stock footage/photos. Get a key at https://pixabay.com/api/docs/ */
export class PixabayProvider implements StockFootageProvider {
  readonly name = "pixabay";

  constructor(private readonly options: PixabayProviderOptions) {}

  async search(req: StockSearchRequest): Promise<StockClipRef[]> {
    const query = req.keywords.join(" ");
    const perPage = req.perPage ?? 10;

    if (req.mediaType === "video") {
      const url = `https://pixabay.com/api/videos/?key=${this.options.apiKey}&q=${encodeURIComponent(query)}&per_page=${perPage}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Pixabay video search failed: ${response.status}`);
      const data = (await response.json()) as { hits: PixabayVideoHit[] };
      return data.hits
        .filter((hit) => matchesOrientation(hit.videos.medium.width, hit.videos.medium.height, req.orientation))
        .map((hit) => ({
          id: String(hit.id),
          provider: this.name,
          mediaType: "video" as const,
          url: hit.videos.large.url ?? hit.videos.medium.url,
          previewUrl: hit.pageURL,
          width: hit.videos.medium.width,
          height: hit.videos.medium.height,
          durationSeconds: hit.duration,
          attribution: `Video by Pixabay (${hit.pageURL})`,
        }));
    }

    const url = `https://pixabay.com/api/?key=${this.options.apiKey}&q=${encodeURIComponent(query)}&image_type=photo&per_page=${perPage}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pixabay image search failed: ${response.status}`);
    const data = (await response.json()) as { hits: PixabayImageHit[] };
    return data.hits
      .filter((hit) => matchesOrientation(hit.imageWidth, hit.imageHeight, req.orientation))
      .map((hit) => ({
        id: String(hit.id),
        provider: this.name,
        mediaType: "image" as const,
        url: hit.largeImageURL,
        previewUrl: hit.pageURL,
        width: hit.imageWidth,
        height: hit.imageHeight,
        attribution: `Image by Pixabay (${hit.pageURL})`,
      }));
  }

  async download(clip: StockClipRef, destPath: string): Promise<string> {
    return downloadUrlTo(clip.url, destPath);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`https://pixabay.com/api/?key=${this.options.apiKey}&q=test`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
