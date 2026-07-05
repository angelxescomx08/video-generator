export interface PublishRequest {
  videoFilePath: string;
  title: string;
  description: string;
  tags?: string[];
  visibility?: "public" | "unlisted" | "private";
  isShort?: boolean;
  thumbnailFilePath?: string;
}

export interface PublishResult {
  externalVideoId: string;
  externalUrl: string;
}

export interface StatsSnapshot {
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  avgViewDurationSeconds?: number;
  avgViewPercentage?: number;
  impressions?: number;
  raw: Record<string, unknown>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface PlatformAccountRef {
  accessToken: string;
  refreshToken?: string;
  externalAccountId?: string;
}

export interface SocialPlatformProvider {
  readonly name: "youtube" | "facebook";
  getAuthUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  publish(account: PlatformAccountRef, req: PublishRequest): Promise<PublishResult>;
  fetchStats(account: PlatformAccountRef, externalVideoId: string): Promise<StatsSnapshot>;
}
