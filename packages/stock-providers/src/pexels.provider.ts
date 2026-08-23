import type { StockClipRef, StockSearchRequest } from "@video-generator/types";
import { downloadUrlTo } from "./download-util";
import { freeStockCost } from "./pricing";
import type { StockFootageProvider } from "./types";

interface PexelsProviderOptions {
  apiKey: string;
}

interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  quality: string;
}

interface PexelsVideoHit {
  id: number;
  url: string;
  duration: number;
  video_files: PexelsVideoFile[];
  user?: { name?: string };
}

interface PexelsPhotoHit {
  id: number;
  url: string;
  width: number;
  height: number;
  src: { large2x: string };
  photographer?: string;
}

function pickBestVideoFile(files: PexelsVideoFile[]): PexelsVideoFile {
  return files.find((f) => f.quality === "hd") ?? files[0]!;
}

/**
 * Los terminos de la API de Pexels exigen acreditar a Pexels Y al autor con un enlace visible
 * (la descarga manual desde la web no lo pide, la API si). Por eso se guarda el nombre del autor.
 */
function pexelsCredit(kind: "Video" | "Photo", authorName: string | undefined, pageUrl: string): string {
  return authorName ? `${kind} by ${authorName} on Pexels (${pageUrl})` : `${kind} on Pexels (${pageUrl})`;
}

/** Free stock footage/photos. Get a key at https://www.pexels.com/api/ */
export class PexelsProvider implements StockFootageProvider {
  readonly name = "pexels";

  constructor(private readonly options: PexelsProviderOptions) {}

  async search(req: StockSearchRequest): Promise<StockClipRef[]> {
    const query = req.keywords.join(" ");
    const perPage = req.perPage ?? 10;
    const orientationParam = req.orientation ? `&orientation=${req.orientation}` : "";

    if (req.mediaType === "video") {
      const response = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}${orientationParam}`,
        { headers: { Authorization: this.options.apiKey } },
      );
      if (!response.ok) throw new Error(`Pexels video search failed: ${response.status}`);
      const data = (await response.json()) as { videos: PexelsVideoHit[] };
      return data.videos.map((hit) => {
        const file = pickBestVideoFile(hit.video_files);
        return {
          id: String(hit.id),
          provider: this.name,
          mediaType: "video" as const,
          url: file.link,
          previewUrl: hit.url,
          width: file.width,
          height: file.height,
          durationSeconds: hit.duration,
          authorName: hit.user?.name,
          attribution: pexelsCredit("Video", hit.user?.name, hit.url),
          cost: freeStockCost(this.name),
        };
      });
    }

    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}${orientationParam}`,
      { headers: { Authorization: this.options.apiKey } },
    );
    if (!response.ok) throw new Error(`Pexels photo search failed: ${response.status}`);
    const data = (await response.json()) as { photos: PexelsPhotoHit[] };
    return data.photos.map((hit) => ({
      id: String(hit.id),
      provider: this.name,
      mediaType: "image" as const,
      url: hit.src.large2x,
      previewUrl: hit.url,
      width: hit.width,
      height: hit.height,
      authorName: hit.photographer,
      attribution: pexelsCredit("Photo", hit.photographer, hit.url),
      cost: freeStockCost(this.name),
    }));
  }

  async download(clip: StockClipRef, destPath: string): Promise<string> {
    return downloadUrlTo(clip.url, destPath);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch("https://api.pexels.com/v1/search?query=test&per_page=1", {
        headers: { Authorization: this.options.apiKey },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
