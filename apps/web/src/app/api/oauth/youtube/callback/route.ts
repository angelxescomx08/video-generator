import { encryptSecret, loadEnv } from "@video-generator/config";
import { db, platformAccounts } from "@/lib/db";
import { YouTubeProvider } from "@video-generator/social-providers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  const provider = new YouTubeProvider();
  const tokens = await provider.exchangeCodeForTokens(code);

  await db.insert(platformAccounts).values({
    platform: "youtube",
    accountLabel: "YouTube channel",
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : undefined,
    tokenExpiresAt: tokens.expiresAt,
    scopes: ["youtube.upload", "youtube.readonly", "yt-analytics.readonly"],
  });

  const env = loadEnv();
  return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/settings/accounts`);
}
