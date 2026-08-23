import type { ProviderCost } from "./cost";

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
  /** Autor del material. Necesario para acreditar cuando la licencia lo exige (ej. API de Pexels). */
  authorName?: string;
  /** Linea de credito ya armada, lista para pegar en la descripcion del video. */
  attribution?: string;
  cost?: ProviderCost;
}
