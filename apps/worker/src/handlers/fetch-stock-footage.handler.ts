import type { ScriptScene } from "@video-generator/ai-providers";
import { db, videos } from "@video-generator/db";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { requiresAttribution, resolveStockProviders, type StockFootageProvider } from "@video-generator/stock-providers";
import type { CostItem, ProviderCost, StockClipRef } from "@video-generator/types";
import { eq } from "drizzle-orm";
import path from "node:path";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
import { getJobWorkspace } from "../util/tmp-workspace";
import { logger } from "../util/logger";

interface SceneClip {
  sceneIndex: number;
  clip: StockClipRef;
  localPath: string;
}

/** Terminos genericos en ingles, casi siempre disponibles en los bancos de stock, usados solo si
 * ni las keywords originales ni cada una por separado devolvieron resultados. */
const GENERIC_FALLBACK_KEYWORDS = ["nature background", "abstract texture", "city aerial", "clouds sky"];

interface ClipCandidate {
  clip: StockClipRef;
  provider: StockFootageProvider;
}

/** Cuantos candidatos juntar por escena antes de empezar a descargar. >1 permite que si la descarga
 * de uno falla (404, red, rate limit) se intente con otro sin tumbar la generacion. Se guardan mas de
 * los que hacen falta para eso porque tambien son el material con el que la deduplicacion evita
 * repetir plano: sin alternativas, un clip ya usado se repite igual. No cuesta llamadas extra — la
 * busqueda ya pide 5 resultados y antes se tiraban. */
const CANDIDATES_PER_SCENE = 5;
/** Maximo de clips que se toman de un mismo proveedor, para que los candidatos abarquen varios. */
const MAX_PER_PROVIDER = 3;

/**
 * Rota el orden de los proveedores segun la escena.
 *
 * Sin esto, con Pixabay + Pexels habilitados el bucle probaba siempre Pixabay primero y, como casi
 * siempre devuelve algo, Pexels practicamente nunca aportaba material: habilitar dos proveedores no
 * daba ninguna variedad real. Rotando, la escena 1 arranca por Pixabay, la 2 por Pexels, etc.
 */
function rotate<T>(items: T[], offset: number): T[] {
  if (items.length <= 1) return items;
  const shift = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

/**
 * Junta varios candidatos para una escena, en orden de preferencia, combinando proveedores.
 *
 * Prueba las keywords originales, luego cada una por separado (mas laxo que el join completo), y por
 * ultimo terminos genericos — para no tumbar el video entero por una escena sin match. Un proveedor
 * que falle en la busqueda solo se salta: los demas siguen aportando.
 */
async function findSceneCandidates(
  providers: StockFootageProvider[],
  scene: ScriptScene,
  orientation: "landscape" | "portrait",
): Promise<ClipCandidate[]> {
  const queryVariants: string[][] = [
    scene.visualKeywords,
    ...scene.visualKeywords.map((kw) => [kw]),
    ...GENERIC_FALLBACK_KEYWORDS.map((kw) => [kw]),
  ];
  const ordered = rotate(providers, scene.index);

  for (let i = 0; i < queryVariants.length; i++) {
    const keywords = queryVariants[i]!;
    const candidates: ClipCandidate[] = [];

    for (const provider of ordered) {
      try {
        const results = await provider.search({ keywords, mediaType: "video", orientation, perPage: 5 });
        for (const clip of results.slice(0, MAX_PER_PROVIDER)) candidates.push({ clip, provider });
      } catch (err) {
        logger.warn(`Busqueda de stock fallida en ${provider.name} para escena ${scene.index}`, {
          error: (err as Error).message,
        });
      }
      if (candidates.length >= CANDIDATES_PER_SCENE) break;
    }

    if (candidates.length > 0) {
      if (i > 0) {
        logger.warn(
          `Escena ${scene.index}: sin resultados para "${scene.visualKeywords.join(", ")}", usando fallback "${keywords.join(" ")}"`,
        );
      }
      return candidates;
    }
  }
  return [];
}

/** Identidad estable de un clip: el mismo id puede existir en dos bancos distintos. */
function clipKey(clip: StockClipRef): string {
  return `${clip.provider}:${clip.id}`;
}

/**
 * Descarga el primer candidato que funcione; si uno falla, sigue con el siguiente proveedor/clip.
 *
 * Los clips ya usados en este video se prueban al final, no se descartan. Dos escenas con keywords
 * parecidas ("desert", "desert sand") le piden lo mismo al banco y reciben el mismo clip arriba del
 * ranking, asi que el video repetia plano justo donde deberia cambiar — y el problema crece con el
 * numero de escenas. Ponerlos al final basta: si hay alternativa se usa, y si no la hay se repite el
 * clip antes que tumbar la generacion por una escena.
 */
async function downloadFirstWorkingCandidate(
  candidates: ClipCandidate[],
  scene: ScriptScene,
  workspace: string,
  usedClipKeys: Set<string>,
): Promise<SceneClip | null> {
  const ordered = [
    ...candidates.filter((c) => !usedClipKeys.has(clipKey(c.clip))),
    ...candidates.filter((c) => usedClipKeys.has(clipKey(c.clip))),
  ];

  for (const candidate of ordered) {
    const ext = candidate.clip.mediaType === "video" ? "mp4" : "jpg";
    const localPath = path.join(workspace, `scene-${scene.index}-clip.${ext}`);
    try {
      await candidate.provider.download(candidate.clip, localPath);
      usedClipKeys.add(clipKey(candidate.clip));
      return { sceneIndex: scene.index, clip: candidate.clip, localPath };
    } catch (err) {
      logger.warn(
        `Descarga fallida en ${candidate.provider.name} para escena ${scene.index}, probando siguiente candidato`,
        { error: (err as Error).message },
      );
    }
  }
  return null;
}

export async function handleFetchStockFootage(payload: VideoJobPayload): Promise<void> {
  const { videoId } = videoJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  const scenes = (video.scenes as ScriptScene[] | null) ?? [];
  if (scenes.length === 0) throw new Error(`Video ${videoId} has no scenes`);

  const orientation = video.format === "short" ? "portrait" : "landscape";

  await runStage(videoId, STAGES.stock!, async () => {
    const providers = await resolveStockProviders();
    if (providers.length === 0) throw new Error("No stock footage providers are configured/enabled");

    const workspace = await getJobWorkspace(videoId);
    const sceneClips: SceneClip[] = [];
    const clipCosts: ProviderCost[] = [];
    const usedClipKeys = new Set<string>();

    for (const scene of scenes) {
      const candidates = await findSceneCandidates(providers, scene, orientation);
      if (candidates.length === 0) {
        throw new Error(
          `No stock footage found for scene ${scene.index} (keywords: ${scene.visualKeywords.join(", ")}), ni siquiera con los fallbacks genericos`,
        );
      }

      const downloaded = await downloadFirstWorkingCandidate(candidates, scene, workspace, usedClipKeys);
      if (!downloaded) {
        throw new Error(
          `Ningun candidato se pudo descargar para la escena ${scene.index} (${candidates.length} intentos en ${new Set(candidates.map((c) => c.provider.name)).size} proveedores)`,
        );
      }

      sceneClips.push(downloaded);
      clipCosts.push(
        downloaded.clip.cost ?? {
          providerType: "stock",
          providerName: downloaded.clip.provider,
          isFree: true,
          isLocal: false,
          amountUsd: 0,
        },
      );
    }

    await db.update(videos).set({ sceneClips, updatedAt: new Date() }).where(eq(videos.id, videoId));

    // Cuantas escenas aporto cada proveedor — es la forma de ver si la variedad esta funcionando.
    const clipsByProvider = sceneClips.reduce<Record<string, number>>((acc, sc) => {
      acc[sc.clip.provider] = (acc[sc.clip.provider] ?? 0) + 1;
      return acc;
    }, {});

    const stockCost: CostItem = {
      stage: "stock_footage",
      providerType: "stock",
      // Con varios proveedores en un mismo video, quedarse con el primero era enganoso.
      providerName: Object.keys(clipsByProvider).sort().join(" + ") || "stock",
      isFree: clipCosts.every((c) => c.isFree),
      isLocal: clipCosts.every((c) => c.isLocal),
      amountUsd: clipCosts.reduce((sum, c) => sum + c.amountUsd, 0),
      units: sceneClips.length,
      unitKind: "clips",
      detail: `${scenes.length} escenas`,
    };

    const needsCredit = [...new Set(sceneClips.map((sc) => sc.clip.provider))].filter(requiresAttribution);
    if (needsCredit.length > 0) {
      logger.info(
        `Video ${videoId} usa material que EXIGE atribucion (${needsCredit.join(", ")}) — los creditos estan en la pagina del video`,
      );
    }

    // `uniqueClips < scenes` significa que hubo que repetir plano por falta de alternativas: es la
    // senal de que las visualKeywords de varias escenas estan pidiendo lo mismo.
    logger.info(`Stock footage fetched for video ${videoId}`, {
      scenes: sceneClips.length,
      uniqueClips: usedClipKeys.size,
      clipsByProvider,
    });
    return { sceneClips, costs: [stockCost] };
  });

  await setVideoStatus(videoId, "building_edl");
  const boss = await getBoss();
  await boss.send(QUEUES.BUILD_EDL, { videoId });
}
