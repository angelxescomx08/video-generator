export interface PublishRequest {
  videoFilePath: string;
  title: string;
  description: string;
  tags?: string[];
  visibility?: "public" | "unlisted" | "private";
  isShort?: boolean;
  thumbnailFilePath?: string;
  /** categoryId de YouTube. Si se omite, YouTube asigna su cajon por defecto (22, Gente y blogs). */
  categoryId?: string;
}

export interface PublishResult {
  externalVideoId: string;
  externalUrl: string;
}

/** Un punto de la curva de retencion: en `elapsedRatio` del video, `watchRatio` seguia viendo. */
export interface RetentionPoint {
  elapsedRatio: number;
  watchRatio: number;
}

/**
 * Todo lo opcional es opcional de verdad: cada metrica vive en un endpoint distinto y puede faltar
 * por falta de scope, por ser un Short (no hay CTR) o porque YouTube aun no la calculo (la curva de
 * retencion tarda ~48h). `undefined` significa "sin dato", nunca cero — quien consuma esto debe
 * descartarlo, no tratarlo como rendimiento nulo.
 */
export interface StatsSnapshot {
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  avgViewDurationSeconds?: number;
  avgViewPercentage?: number;
  impressions?: number;
  impressionsCtr?: number;
  engagedViews?: number;
  subscribersGained?: number;
  subscribersLost?: number;
  watchTimeHours?: number;
  stayedToWatchPercentage?: number;
  /** % que seguia viendo al segundo 3, derivado de la curva — la nota del gancho. */
  retentionAtStartPercentage?: number;
  retentionCurve?: RetentionPoint[];
  trafficSources?: Record<string, number>;
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

/** Datos de un video que ya vive en la plataforma, para verificar un vinculo hecho a mano. */
export interface RemoteVideoMetadata {
  externalVideoId: string;
  title: string;
  /** Fecha real de publicacion en la plataforma; de aqui sale la edad del video. */
  publishedAt: Date | null;
  channelId?: string;
}

export interface SocialPlatformProvider {
  readonly name: "youtube" | "facebook";
  getAuthUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  publish(account: PlatformAccountRef, req: PublishRequest): Promise<PublishResult>;
  fetchStats(account: PlatformAccountRef, externalVideoId: string): Promise<StatsSnapshot>;
  /**
   * Lee la metadata de un video que ya esta en la plataforma. Opcional porque solo hace falta para
   * vincular a mano un video subido por fuera de la app, y no toda plataforma lo soporta igual.
   */
  fetchVideoMetadata?(
    account: PlatformAccountRef,
    externalVideoId: string,
  ): Promise<RemoteVideoMetadata | null>;

  /**
   * Busca entre las subidas recientes de la cuenta una que coincida con `title`.
   *
   * Sirve para detectar una subida HUERFANA: cuando el archivo llego a la plataforma pero la respuesta
   * se perdio (conexion cortada), no hay id que guardar y el sistema cree que fallo. Sin esta consulta,
   * el siguiente intento sube el mismo video otra vez. Opcional porque no toda plataforma permite
   * listar las subidas recientes.
   */
  findRecentUploadByTitle?(
    account: PlatformAccountRef,
    title: string,
  ): Promise<RemoteVideoMetadata | null>;
}
