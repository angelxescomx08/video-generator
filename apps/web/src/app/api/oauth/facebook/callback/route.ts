import { encryptSecret, loadEnv } from "@video-generator/config";
import { db, platformAccounts } from "@/lib/db";
import { FacebookProvider } from "@video-generator/social-providers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  const provider = new FacebookProvider();
  const tokens = await provider.exchangeCodeForTokens(code);

  // NOTE: publishing needs the target Page ID (externalAccountId), which requires an extra
  // "GET /me/accounts" call to let the user pick a Page. Left unset here — set it manually
  // (e.g. via `pnpm db:studio`) before publishing to this account for the first time.
  await db.insert(platformAccounts).values({
    platform: "facebook",
    accountLabel: "Facebook Page",
    accessToken: encryptSecret(tokens.accessToken),
    tokenExpiresAt: tokens.expiresAt,
    scopes: ["pages_manage_posts", "pages_read_engagement", "read_insights"],
  });

  const env = loadEnv();
  return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/settings/accounts`);
}
