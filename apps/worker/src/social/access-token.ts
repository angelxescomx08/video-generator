import { decryptSecret, encryptSecret } from "@video-generator/config";
import { db, platformAccounts, type PlatformAccount } from "@video-generator/db";
import type { SocialPlatformProvider } from "@video-generator/social-providers";
import { eq } from "drizzle-orm";

/** Margen antes del vencimiento: refresca si al token le quedan menos de 5 minutos. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Devuelve un access token valido para la cuenta, refrescandolo y volviendolo a guardar cifrado si
 * esta por vencer.
 *
 * Vive aparte de los handlers porque los access tokens de Google duran una hora y CUALQUIER handler
 * que llame a la API de la plataforma lo necesita, no solo el de publicar. El poll de estadisticas
 * usaba el token guardado tal cual, asi que a la hora de conectar la cuenta empezaba a recibir 401 y
 * los guardaba como un warning silencioso — las estadisticas simplemente dejaban de actualizarse sin
 * que nada lo dijera.
 */
export async function resolveAccessToken(
  account: PlatformAccount,
  provider: SocialPlatformProvider,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const refreshToken = account.refreshToken ? decryptSecret(account.refreshToken) : undefined;
  const accessToken = decryptSecret(account.accessToken);

  const isExpiringSoon =
    account.tokenExpiresAt !== null && account.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;

  if (!isExpiringSoon || !refreshToken) return { accessToken, refreshToken };

  const refreshed = await provider.refreshTokens(refreshToken);
  await db
    .update(platformAccounts)
    .set({
      accessToken: encryptSecret(refreshed.accessToken),
      tokenExpiresAt: refreshed.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(platformAccounts.id, account.id));

  return { accessToken: refreshed.accessToken, refreshToken };
}
