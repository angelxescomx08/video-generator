export interface StockSearchRequest {
  keywords: string[];
  mediaType: "video" | "image";
  orientation?: "landscape" | "portrait" | "square";
  minDurationSeconds?: number;
  perPage?: number;
}

export interface StockClipRef {
  id: string;
  provider: string;
  mediaType: "video" | "image";
  url: string;
  previewUrl?: string;
  width: number;
  height: number;
  durationSeconds?: number;
  attribution?: string;
}
