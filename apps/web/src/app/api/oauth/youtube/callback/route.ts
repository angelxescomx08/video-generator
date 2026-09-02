import { encryptSecret, loadEnv } from "@video-generator/config";
import { db, platformAccounts } from "@/lib/db";
import { YouTubeProvider } from "@video-generator/social-providers";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const SCOPES = ["youtube.upload", "youtube.readonly", "yt-analytics.readonly"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  const provider = new YouTubeProvider();
  const tokens = await provider.exchangeCodeForTokens(code);

  const values = {
    platform: "youtube" as const,
    accountLabel: "YouTube channel",
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : undefined,
    tokenExpiresAt: tokens.expiresAt,
    scopes: SCOPES,
  };

  // Reconectar ACTUALIZA la cuenta existente en vez de insertar otra fila. No es cosmetico:
  // `published_videos.platform_account_id` apunta a la fila vieja, asi que una segunda fila dejaria
  // a todos los videos ya publicados colgados del refresh token muerto — el poll de estadisticas
  // seguiria fallando cada 6h despues de "reconectar". Y `link-youtube` elige la cuenta con un
  // `limit 1` sin ORDER BY, asi que con dos filas activas cual gana es indeterminado.
  // Google solo devuelve `refresh_token` cuando el consentimiento se pide con `prompt=consent`
  // (getAuthUrl lo hace); si aun asi no viene, se conserva el guardado en vez de borrarlo.
  const existing = await db.query.platformAccounts.findFirst({
    where: eq(platformAccounts.platform, "youtube"),
  });

  if (existing) {
    await db
      .update(platformAccounts)
      .set({
        ...values,
        refreshToken: values.refreshToken ?? existing.refreshToken,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(platformAccounts.id, existing.id));
  } else {
    await db.insert(platformAccounts).values(values);
  }

  const env = loadEnv();
  return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/settings/accounts`);
}
