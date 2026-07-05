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

const SCOPES = ["pages_manage_posts", "pages_read_engagement", "pages_show_list", "read_insights"];
const GRAPH_VERSION = "v21.0";

interface FacebookTokenResponse {
  access_token: string;
  expires_in?: number;
}

/** Publishes to a Facebook Page (also covers Instagram via a linked Page, same Graph API family). */
export class FacebookProvider implements SocialPlatformProvider {
  readonly name = "facebook" as const;

  getAuthUrl(state: string): string {
    const env = loadEnv();
    const params = new URLSearchParams({
      client_id: env.FACEBOOK_APP_ID ?? "",
      redirect_uri: env.FACEBOOK_REDIRECT_URI ?? "",
      scope: SCOPES.join(","),
      state,
      response_type: "code",
    });
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    const env = loadEnv();
    const params = new URLSearchParams({
      client_id: env.FACEBOOK_APP_ID ?? "",
      client_secret: env.FACEBOOK_APP_SECRET ?? "",
      redirect_uri: env.FACEBOOK_REDIRECT_URI ?? "",
      code,
    });
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params}`);
    if (!response.ok) throw new Error(`Facebook token exchange failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as FacebookTokenResponse;
    return {
      accessToken: data.access_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    // Facebook long-lived Page tokens don't expire via refresh_token; re-exchange a long-lived
    // user token instead. Kept for interface parity with other platforms.
    const env = loadEnv();
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: env.FACEBOOK_APP_ID ?? "",
      client_secret: env.FACEBOOK_APP_SECRET ?? "",
      fb_exchange_token: refreshToken,
    });
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params}`);
    if (!response.ok) throw new Error(`Facebook token refresh failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as FacebookTokenResponse;
    return { accessToken: data.access_token, refreshToken };
  }

  async publish(account: PlatformAccountRef, req: PublishRequest): Promise<PublishResult> {
    if (!account.externalAccountId) {
      throw new Error("Facebook publish requires externalAccountId (the Page ID)");
    }

    const videoBuffer = await readFile(req.videoFilePath);
    const form = new FormData();
    form.append("access_token", account.accessToken);
    form.append("description", req.description);
    form.append("title", req.title);
    form.append("source", new Blob([videoBuffer], { type: "video/mp4" }), "video.mp4");

    const response = await fetch(`https://graph-video.facebook.com/${GRAPH_VERSION}/${account.externalAccountId}/videos`, {
      method: "POST",
      body: form,
    });

    if (!response.ok) throw new Error(`Facebook publish failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as { id: string };
    return { externalVideoId: data.id, externalUrl: `https://www.facebook.com/${data.id}` };
  }

  async fetchStats(account: PlatformAccountRef, externalVideoId: string): Promise<StatsSnapshot> {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${externalVideoId}/video_insights?metric=total_video_views,total_video_impressions,total_video_likes_by_reaction_type,total_video_comments,total_video_shares&access_token=${account.accessToken}`,
    );
    if (!response.ok) throw new Error(`Facebook insights failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as {
      data: { name: string; values: { value: number | Record<string, number> }[] }[];
    };

    const metric = (name: string): number => {
      const entry = data.data.find((d) => d.name === name);
      const value = entry?.values[0]?.value;
      if (typeof value === "number") return value;
      if (value && typeof value === "object") return Object.values(value).reduce((a, b) => a + b, 0);
      return 0;
    };

    return {
      views: metric("total_video_views"),
      likes: metric("total_video_likes_by_reaction_type"),
      comments: metric("total_video_comments"),
      shares: metric("total_video_shares"),
      impressions: metric("total_video_impressions"),
      raw: { insights: data },
    };
  }
}
