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
 * de uno falla (404, red, rate limit) se intente con otro sin tumbar la generacion. */
const CANDIDATES_PER_SCENE = 3;
/** Maximo de clips que se toman de un mismo proveedor, para que los candidatos abarquen varios. */
const MAX_PER_PROVIDER = 2;

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

/** Descarga el primer candidato que funcione; si uno falla, sigue con el siguiente proveedor/clip. */
async function downloadFirstWorkingCandidate(
  candidates: ClipCandidate[],
  scene: ScriptScene,
  workspace: string,
): Promise<SceneClip | null> {
  for (const candidate of candidates) {
    const ext = candidate.clip.mediaType === "video" ? "mp4" : "jpg";
    const localPath = path.join(workspace, `scene-${scene.index}-clip.${ext}`);
    try {
      await candidate.provider.download(candidate.clip, localPath);
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

    for (const scene of scenes) {
      const candidates = await findSceneCandidates(providers, scene, orientation);
      if (candidates.length === 0) {
        throw new Error(
          `No stock footage found for scene ${scene.index} (keywords: ${scene.visualKeywords.join(", ")}), ni siquiera con los fallbacks genericos`,
        );
      }

      const downloaded = await downloadFirstWorkingCandidate(candidates, scene, workspace);
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

    logger.info(`Stock footage fetched for video ${videoId}`, { scenes: sceneClips.length, clipsByProvider });
    return { sceneClips, costs: [stockCost] };
  });

  await setVideoStatus(videoId, "building_edl");
  const boss = await getBoss();
  await boss.send(QUEUES.BUILD_EDL, { videoId });
}
