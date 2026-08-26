import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnv } from "@video-generator/config";
import type {
  OAuthTokens,
  PlatformAccountRef,
  PublishRequest,
  PublishResult,
  RemoteVideoMetadata,
  RetentionPoint,
  SocialPlatformProvider,
  StatsSnapshot,
} from "./types";

/** YouTube rechaza el request si snippet.tags concatenados (con comas) pasan de 500 caracteres. */
function sanitizeTags(tags: string[]): string[] {
  const result: string[] = [];
  let totalLength = 0;
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    totalLength += tag.length + 1; // +1 por la coma que YouTube usa para unirlos internamente.
    if (totalLength > 500) break;
    result.push(tag);
  }
  return result;
}

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
        tags: sanitizeTags(req.tags ?? []),
        // Sin categoryId YouTube usa su default (22). Declararla explicitamente ayuda a que el
        // video se recomiende junto al contenido correcto.
        ...(req.categoryId ? { categoryId: req.categoryId } : {}),
      },
      status: {
        privacyStatus: req.visibility ?? "public",
        // "No es contenido para ninos": afecta comentarios, recomendaciones y personalizacion. Se
        // declara explicitamente porque YouTube OBLIGA a responderlo y no declararlo bloquea el video.
        selfDeclaredMadeForKids: false,
        // Declaracion de contenido alterado o sintetico. Estos videos llevan narracion generada por
        // TTS sobre un guion escrito por un LLM, asi que la declaracion corresponde: YouTube exige
        // marcarlo cuando el contenido puede confundirse con algo real, y omitirlo expone el canal a
        // sanciones. El nombre del campo se verifico contra el esquema VideoStatus de la Data API v3.
        containsSyntheticMedia: true,
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

  /**
   * Confirma que el video existe y que la cuenta conectada lo puede ver, y devuelve su fecha real de
   * publicacion. Esa fecha es la que hace comparables los snapshots: sin ella no se sabe la edad del
   * video y las guardas del motor de aprendizaje (ignorar videos de menos de N dias) no pueden
   * aplicarse.
   *
   * Devuelve null si el ID no corresponde a ningun video visible, para poder rechazar un vinculo mal
   * pegado antes de guardarlo.
   */
  async fetchVideoMetadata(
    account: PlatformAccountRef,
    externalVideoId: string,
  ): Promise<RemoteVideoMetadata | null> {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(externalVideoId)}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } },
    );
    if (!response.ok) throw new Error(`YouTube Data API lookup failed: ${response.status} ${await response.text()}`);

    const json = (await response.json()) as {
      items?: { id: string; snippet?: { title?: string; publishedAt?: string; channelId?: string } }[];
    };
    const item = json.items?.[0];
    if (!item) return null;

    return {
      externalVideoId: item.id,
      title: item.snippet?.title ?? "(sin titulo)",
      publishedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null,
      channelId: item.snippet?.channelId,
    };
  }

  /**
   * Busca en las subidas mas recientes del canal un video con este titulo exacto.
   *
   * Se usa antes de publicar para no duplicar una subida que ya llego: si la conexion murio despues de
   * enviar el archivo pero antes de recibir el id, el video quedo en el canal y aqui se recupera para
   * adoptarlo en vez de subirlo de nuevo.
   *
   * Solo se miran las ultimas subidas (una pagina) porque el caso que interesa es siempre reciente —
   * minutos, no dias.
   */
  async findRecentUploadByTitle(
    account: PlatformAccountRef,
    title: string,
  ): Promise<RemoteVideoMetadata | null> {
    const channelResponse = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
      { headers: { Authorization: `Bearer ${account.accessToken}` } },
    );
    if (!channelResponse.ok) return null;
    const channelJson = (await channelResponse.json()) as {
      items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
    };
    const uploadsPlaylist = channelJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylist) return null;

    const itemsResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=25&playlistId=${uploadsPlaylist}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } },
    );
    if (!itemsResponse.ok) return null;
    const itemsJson = (await itemsResponse.json()) as {
      items?: { snippet?: { title?: string; publishedAt?: string; channelId?: string; resourceId?: { videoId?: string } } }[];
    };

    const match = itemsJson.items?.find((item) => item.snippet?.title === title);
    const videoId = match?.snippet?.resourceId?.videoId;
    if (!match || !videoId) return null;

    return {
      externalVideoId: videoId,
      title: match.snippet?.title ?? title,
      publishedAt: match.snippet?.publishedAt ? new Date(match.snippet.publishedAt) : null,
      channelId: match.snippet?.channelId,
    };
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

    // Cada grupo va por separado y falla solo: si el canal no tiene acceso a `impressions` o
    // YouTube todavia no calculo la retencion, el resto de las metricas siguen llegando.
    const [core, reach, retention, traffic] = await Promise.all([
      this.analyticsRow(account, externalVideoId, ANALYTICS_CORE_METRICS),
      this.analyticsRow(account, externalVideoId, ANALYTICS_REACH_METRICS),
      this.retentionCurve(account, externalVideoId),
      this.trafficSources(account, externalVideoId),
    ]);

    const views = Number(stats.viewCount);

    // La Data API es casi en vivo, pero los reportes de Analytics tardan 48-72h en procesarse y
    // mientras tanto devuelven una fila de PUROS CEROS en vez de no devolver fila. Guardar esos ceros
    // seria registrar "0% de retencion" como una medicion real, cuando en realidad es "sin dato": con
    // views > 0 es imposible que nadie haya visto nada. Se descarta el grupo entero para que quede en
    // null, que es lo que el motor de aprendizaje sabe ignorar.
    const analyticsReady = core !== null && !(views > 0 && core.estimatedMinutesWatched === 0);
    const ready = analyticsReady ? core : null;
    const watchedMinutes = ready?.estimatedMinutesWatched;

    return {
      views,
      likes: Number(stats.likeCount),
      comments: Number(stats.commentCount),
      shares: ready?.shares,
      avgViewDurationSeconds: ready?.averageViewDuration,
      avgViewPercentage: ready?.averageViewPercentage,
      subscribersGained: ready?.subscribersGained,
      subscribersLost: ready?.subscribersLost,
      watchTimeHours: watchedMinutes === undefined ? undefined : watchedMinutes / 60,
      impressions: reach?.impressions,
      impressionsCtr: reach?.impressionsClickThroughRate,
      engagedViews: reach?.engagedViews,
      retentionCurve: retention?.curve,
      retentionAtStartPercentage: retention?.atStartPercentage,
      trafficSources: traffic,
      raw: {
        dataApi: stats,
        analyticsCore: core,
        analyticsReach: reach,
        trafficSources: traffic,
        // Se deja rastro de por que las metricas de Analytics pudieron quedar en null, para no tener
        // que adivinar despues si fue falta de permisos o el retraso de procesamiento de YouTube.
        analyticsReady,
      },
    };
  }

  /**
   * Pide un grupo de metricas agregadas de la Analytics API y las devuelve indexadas por nombre.
   * Devuelve null (no lanza) si el grupo entero no esta disponible: una metrica no soportada por el
   * canal hace fallar el request completo con 400, y perder un grupo opcional no debe tumbar el poll.
   */
  private async analyticsRow(
    account: PlatformAccountRef,
    externalVideoId: string,
    metrics: readonly string[],
  ): Promise<Record<string, number> | null> {
    try {
      const params = new URLSearchParams({
        ids: "channel==MINE",
        startDate: ANALYTICS_START_DATE,
        endDate: todayIsoDate(),
        metrics: metrics.join(","),
        filters: `video==${externalVideoId}`,
      });
      const response = await fetch(`${ANALYTICS_BASE_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      if (!response.ok) return null;
      const json = (await response.json()) as { columnHeaders?: { name: string }[]; rows?: number[][] };
      const row = json.rows?.[0];
      if (!row || !json.columnHeaders) return null;
      const result: Record<string, number> = {};
      json.columnHeaders.forEach((header, i) => {
        const value = row[i];
        if (typeof value === "number") result[header.name] = value;
      });
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Curva de retencion (`audienceWatchRatio` sobre la dimension `elapsedVideoTimeRatio`): para cada
   * decil del video, que fraccion de la audiencia seguia viendo. YouTube tarda hasta ~48h en
   * calcularla y no la publica si el video no junto suficientes vistas, asi que la respuesta vacia es
   * el caso normal en un video recien subido, no un error.
   */
  private async retentionCurve(
    account: PlatformAccountRef,
    externalVideoId: string,
  ): Promise<{ curve: RetentionPoint[]; atStartPercentage?: number } | null> {
    try {
      const params = new URLSearchParams({
        ids: "channel==MINE",
        startDate: ANALYTICS_START_DATE,
        endDate: todayIsoDate(),
        metrics: "audienceWatchRatio",
        dimensions: "elapsedVideoTimeRatio",
        filters: `video==${externalVideoId}`,
        sort: "elapsedVideoTimeRatio",
      });
      const response = await fetch(`${ANALYTICS_BASE_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      if (!response.ok) return null;
      const json = (await response.json()) as { rows?: [number, number][] };
      if (!json.rows?.length) return null;

      const curve: RetentionPoint[] = json.rows.map(([elapsedRatio, watchRatio]) => ({
        elapsedRatio,
        watchRatio,
      }));
      return { curve, atStartPercentage: retentionAtStart(curve) };
    } catch {
      return null;
    }
  }

  /** Reparto de vistas por fuente de trafico — distingue "mal video" de "no lo distribuyeron". */
  private async trafficSources(
    account: PlatformAccountRef,
    externalVideoId: string,
  ): Promise<Record<string, number> | undefined> {
    try {
      const params = new URLSearchParams({
        ids: "channel==MINE",
        startDate: ANALYTICS_START_DATE,
        endDate: todayIsoDate(),
        metrics: "views",
        dimensions: "insightTrafficSourceType",
        filters: `video==${externalVideoId}`,
      });
      const response = await fetch(`${ANALYTICS_BASE_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      if (!response.ok) return undefined;
      const json = (await response.json()) as { rows?: [string, number][] };
      if (!json.rows?.length) return undefined;
      return Object.fromEntries(json.rows);
    } catch {
      return undefined;
    }
  }
}

const ANALYTICS_BASE_URL = "https://youtubeanalytics.googleapis.com/v2/reports";

/** Fundacion de YouTube: cubre cualquier video sin tener que conocer su fecha de publicacion. */
const ANALYTICS_START_DATE = "2005-02-14";

/** Metricas que existen para cualquier canal. */
const ANALYTICS_CORE_METRICS = [
  "averageViewDuration",
  "averageViewPercentage",
  "estimatedMinutesWatched",
  "shares",
  "subscribersGained",
  "subscribersLost",
] as const;

/**
 * Metricas de alcance. Van aparte de las core porque `impressions` e `impressionsClickThroughRate`
 * no estan disponibles para todos los canales/formatos (en Shorts normalmente no existen) y un
 * request que las incluya devuelve 400 completo, arrastrando las metricas que si funcionan.
 */
const ANALYTICS_REACH_METRICS = [
  "impressions",
  "impressionsClickThroughRate",
  "engagedViews",
] as const;

/** La API rechaza endDate en el futuro, asi que la ventana se cierra hoy. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Convierte la curva en la unica cifra que de verdad califica el gancho: que porcentaje seguia
 * viendo cerca del inicio. Toma el primer punto pasado el arranque (elapsedRatio > 0) porque el
 * punto 0 siempre vale 1 por definicion y no dice nada.
 */
function retentionAtStart(curve: RetentionPoint[]): number | undefined {
  const point = curve.find((p) => p.elapsedRatio > 0);
  return point ? point.watchRatio * 100 : undefined;
}
