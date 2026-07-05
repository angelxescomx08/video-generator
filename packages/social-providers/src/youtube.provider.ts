import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnv } from "@video-generator/config";
import type {
  OAuthTokens,
  PlatformAccountRef,
  PublishRequest,
  PublishResult,
  SocialPlatformProvider,
  StatsSnapshot,
} from "./types";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export class YouTubeProvider implements SocialPlatformProvider {
  readonly name = "youtube" as const;

  getAuthUrl(state: string): string {
    const env = loadEnv();
    const params = new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID ?? "",
      redirect_uri: env.YOUTUBE_REDIRECT_URI ?? "",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES.join(" "),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    const env = loadEnv();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.YOUTUBE_CLIENT_ID ?? "",
        client_secret: env.YOUTUBE_CLIENT_SECRET ?? "",
        redirect_uri: env.YOUTUBE_REDIRECT_URI ?? "",
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) throw new Error(`YouTube token exchange failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as GoogleTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const env = loadEnv();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: env.YOUTUBE_CLIENT_ID ?? "",
        client_secret: env.YOUTUBE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) throw new Error(`YouTube token refresh failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as GoogleTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async publish(account: PlatformAccountRef, req: PublishRequest): Promise<PublishResult> {
    const metadata = {
      snippet: {
        title: req.title,
        description: req.description,
        tags: req.tags ?? [],
      },
      status: {
        privacyStatus: req.visibility ?? "public",
        selfDeclaredMadeForKids: false,
      },
    };

    const videoBuffer = await readFile(req.videoFilePath);
    const boundary = `boundary-${randomUUID()}`;
    const bodyParts = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    ];
    const closing = `\r\n--${boundary}--`;

    const body = Buffer.concat([
      Buffer.from(bodyParts[0]!),
      Buffer.from(bodyParts[1]!),
      videoBuffer,
      Buffer.from(closing),
    ]);

    const response = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!response.ok) throw new Error(`YouTube upload failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as { id: string };
    return { externalVideoId: data.id, externalUrl: `https://www.youtube.com/watch?v=${data.id}` };
  }

  async fetchStats(account: PlatformAccountRef, externalVideoId: string): Promise<StatsSnapshot> {
    const dataResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${externalVideoId}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } },
    );
    if (!dataResponse.ok) throw new Error(`YouTube Data API stats failed: ${dataResponse.status}`);
    const dataJson = (await dataResponse.json()) as {
      items: { statistics: { viewCount: string; likeCount: string; commentCount: string } }[];
    };
    const stats = dataJson.items[0]?.statistics ?? { viewCount: "0", likeCount: "0", commentCount: "0" };

    let avgViewDurationSeconds: number | undefined;
    let avgViewPercentage: number | undefined;
    try {
      const analyticsResponse = await fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2020-01-01&endDate=2100-01-01&metrics=averageViewDuration,averageViewPercentage&filters=video==${externalVideoId}`,
        { headers: { Authorization: `Bearer ${account.accessToken}` } },
      );
      if (analyticsResponse.ok) {
        const analyticsJson = (await analyticsResponse.json()) as { rows?: number[][] };
        const row = analyticsJson.rows?.[0];
        if (row) {
          avgViewDurationSeconds = row[0];
          avgViewPercentage = row[1];
        }
      }
    } catch {
      // Analytics API is optional (requires extra scope/setup) — Data API stats above still work without it.
    }

    return {
      views: Number(stats.viewCount),
      likes: Number(stats.likeCount),
      comments: Number(stats.commentCount),
      avgViewDurationSeconds,
      avgViewPercentage,
      raw: { dataApi: stats },
    };
  }
}
