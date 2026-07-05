import type { StockClipRef, StockSearchRequest } from "@video-generator/types";

export class NotImplementedError extends Error {
  constructor(providerName: string, method: string) {
    super(`${providerName} does not implement ${method} yet`);
    this.name = "NotImplementedError";
  }
}

export interface StockFootageProvider {
  readonly name: string;
  search(req: StockSearchRequest): Promise<StockClipRef[]>;
  download(clip: StockClipRef, destPath: string): Promise<string>;
  healthCheck(): Promise<boolean>;
}

export type { StockClipRef, StockSearchRequest };
