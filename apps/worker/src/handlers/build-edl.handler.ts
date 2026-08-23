import { resolveProvider } from "@video-generator/ai-providers";
import type { ScriptScene } from "@video-generator/ai-providers";
import { db, themes, videos } from "@video-generator/db";
import { resolveMusicProvider, type MusicProvider } from "@video-generator/music-providers";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { buildFallbackEdl, defaultCaptionStyle, type EDLScene, type EditDecisionList } from "@video-generator/types";
import type { CostItem, MusicTrackRef, StockClipRef } from "@video-generator/types";
import { eq } from "drizzle-orm";
import path from "node:path";
import { estimateWordTimings } from "../captions/word-timing";
import { concatAudioFiles } from "../ffmpeg/concat-audio";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
import { getJobWorkspace } from "../util/tmp-workspace";
import { logger } from "../util/logger";

interface SceneAudio {
  sceneIndex: number;
  audioFilePath: string;
  durationSeconds: number;
}

interface SceneClip {
  sceneIndex: number;
  clip: StockClipRef;
  localPath: string;
}

/** Usados solo si el tema no tiene defaultMusicTags o esas tags no devuelven resultados. */
const GENERIC_MUSIC_TAGS = ["cinematic", "ambient", "background", "calm"];

/**
 * Reconstruye la linea de tiempo del EDL a partir del unico timing real del pipeline: la duracion
 * MEDIDA de cada clip de TTS (sceneAudio, ya concatenado en voiceoverPath). El LLM solo vio
 * duraciones estimadas del guion, asi que sin esto los cortes de video y los subtitulos se van de la
 * narracion real.
 *
 * Ademas arregla dos desalineaciones que hacian que el subtitulo no correspondiera a lo que se
 * escuchaba:
 *
 * 1. El LLM a veces numera las escenas del EDL desde 0 aunque el guion venga numerado desde 1 (o se
 *    salta alguna). Emparejar por indice en ese caso descartaba escenas y corria TODO el resto una
 *    escena respecto a la voz. Si los indices no cuadran, se empareja por POSICION.
 * 2. El texto del subtitulo se toma del GUION (que va 1:1 con el audio por indice), no del EDL
 *    devuelto por el LLM. Se usa `narrationText`, que es exactamente lo que pronuncia el TTS —
 *    `captionText` es un titular/resumen mas corto, util como rotulo pero que no coincide palabra
 *    por palabra con la voz.
 *
 * Se emite una escena por cada clip de audio, de modo que la duracion del video siempre cubre la
 * del voiceover completo (antes, si el LLM devolvia menos escenas, el video quedaba mas corto que
 * el audio).
 */
function reconcileSceneTiming(
  edl: EditDecisionList,
  sceneAudio: SceneAudio[],
  scriptScenes: ScriptScene[],
): EditDecisionList {
  const audioSorted = [...sceneAudio].sort((a, b) => a.sceneIndex - b.sceneIndex);
  const edlSorted = [...edl.scenes].sort((a, b) => a.index - b.index);
  if (edlSorted.length === 0) return { ...edl, scenes: [], totalDurationSeconds: 0 };

  const audioIndices = new Set(audioSorted.map((a) => a.sceneIndex));
  const indicesMatch = edlSorted.every((s) => audioIndices.has(s.index));
  if (!indicesMatch) {
    logger.warn("Los indices de escena del EDL no coinciden con los del audio; alineando por posicion", {
      edlIndices: edlSorted.map((s) => s.index),
      audioIndices: [...audioIndices],
    });
  }

  let cursor = 0;
  const scenes: EDLScene[] = audioSorted.map((audio, position) => {
    const fallbackSource = edlSorted[Math.min(position, edlSorted.length - 1)]!;
    const source = indicesMatch
      ? (edlSorted.find((s) => s.index === audio.sceneIndex) ?? fallbackSource)
      : fallbackSource;
    const scriptScene = scriptScenes.find((s) => s.index === audio.sceneIndex);

    const scene: EDLScene = {
      ...source,
      index: audio.sceneIndex,
      startSeconds: cursor,
      durationSeconds: audio.durationSeconds,
      captionText: scriptScene?.narrationText ?? source.captionText,
      // Se recalculan siempre en withWordTimings() sobre el timing real recien asignado.
      captionWordTimings: undefined,
    };
    cursor += audio.durationSeconds;
    return scene;
  });

  return { ...edl, scenes, totalDurationSeconds: cursor };
}

/** Asigna a cada escena el clip descargado que le corresponde, ya con el indice corregido. */
function withSceneClips(edl: EditDecisionList, sceneClips: SceneClip[]): EditDecisionList {
  const scenes = edl.scenes.map((scene): EDLScene => {
    const match = sceneClips.find((sc) => sc.sceneIndex === scene.index);
    if (!match) return scene;
    return { ...scene, clip: { sourcePath: match.localPath, mediaType: match.clip.mediaType } };
  });
  return { ...edl, scenes };
}

/** Cronometra palabra por palabra el texto de cada escena sobre su duracion real ya reconciliada. */
function withWordTimings(edl: EditDecisionList): EditDecisionList {
  const scenes = edl.scenes.map((scene): EDLScene => {
    if (!scene.captionText) return scene;
    return {
      ...scene,
      captionWordTimings: estimateWordTimings(scene.captionText, scene.startSeconds, scene.durationSeconds),
    };
  });
  return { ...edl, scenes };
}

/** Prueba primero el mood sugerido por la IA (segun el tono real de este video) y las tags del
 * tema, ambas combinadas; luego cada tag por separado (IA, tema, generica en ese orden) — Jamendo
 * (y providers similares) tratan tags=a+b+c como un AND estricto, asi que combinar 3-4 tags casi
 * siempre da 0 resultados y hay que poder caer a una sola tag. La musica de fondo es un extra,
 * nunca debe tumbar la generacion del video. */
async function findBackgroundMusic(
  provider: MusicProvider,
  aiSuggestedTags: string[],
  themeTags: string[],
  minDurationSeconds: number,
): Promise<MusicTrackRef | null> {
  const combinedVariants = [aiSuggestedTags, themeTags].filter((tags) => tags.length > 1);
  const individualTags = [...aiSuggestedTags, ...themeTags, ...GENERIC_MUSIC_TAGS].filter(
    (tag, i, arr) => tag && arr.indexOf(tag) === i,
  );
  const tagVariants: string[][] = [...combinedVariants, ...individualTags.map((tag) => [tag])].filter(
    (tags) => tags.length > 0,
  );

  for (const tags of tagVariants) {
    try {
      const results = await provider.search({ tags, minDurationSeconds, perPage: 5 });
      if (results[0]) return results[0];
    } catch (err) {
      logger.warn(`Music search failed on ${provider.name} for tags "${tags.join(", ")}"`, {
        error: (err as Error).message,
      });
    }
  }
  return null;
}

export async function handleBuildEdl(payload: VideoJobPayload): Promise<void> {
  const { videoId } = videoJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  const theme = await db.query.themes.findFirst({ where: eq(themes.id, video.themeId) });

  const scenes = (video.scenes as ScriptScene[] | null) ?? [];
  const sceneAudio = (video.sceneAudio as SceneAudio[] | null) ?? [];
  const sceneClips = (video.sceneClips as SceneClip[] | null) ?? [];
  if (scenes.length === 0 || sceneAudio.length === 0 || sceneClips.length === 0) {
    throw new Error(`Video ${videoId} is missing scenes/audio/clips required to build the EDL`);
  }

  await runStage(videoId, STAGES.edl!, async () => {
    const workspace = await getJobWorkspace(videoId);

    const voiceoverPath = path.join(workspace, "voiceover.wav");
    await concatAudioFiles(
      sceneAudio.sort((a, b) => a.sceneIndex - b.sceneIndex).map((s) => s.audioFilePath),
      voiceoverPath,
      workspace,
    );

    const provider = await resolveProvider();
    let edl: EditDecisionList;
    let edlCost: CostItem | undefined;
    try {
      const { result, cost } = await provider.generateEDL({
        scenes,
        availableClips: sceneClips.map((sc) => sc.clip),
        format: video.format,
        themeSlug: "",
      });
      edl = result;
      edlCost = { ...cost, stage: "edl" };
    } catch (err) {
      logger.warn(`AI EDL generation failed for video ${videoId}, using deterministic fallback`, {
        error: (err as Error).message,
      });
      edl = buildFallbackEdl({
        format: video.format,
        voiceoverPath,
        scenes: sceneAudio
          .sort((a, b) => a.sceneIndex - b.sceneIndex)
          .map((sa) => {
            const clip = sceneClips.find((sc) => sc.sceneIndex === sa.sceneIndex)!;
            const scene = scenes.find((s) => s.index === sa.sceneIndex);
            return {
              sourcePath: clip.localPath,
              mediaType: clip.clip.mediaType,
              durationSeconds: sa.durationSeconds,
              captionText: scene?.captionText ?? scene?.narrationText,
            };
          }),
      });
    }

    // Fill in file paths the LLM doesn't know about (it only reasoned about scene indices/keywords).
    edl.audio.voiceoverPath = voiceoverPath;

    // El orden importa: reconcileSceneTiming corrige los indices de escena, y solo despues se pueden
    // emparejar los clips por indice — hacerlo antes asignaba el clip equivocado a cada escena
    // cuando el LLM numeraba el EDL desde 0.
    edl = reconcileSceneTiming(edl, sceneAudio, scenes);
    edl = withSceneClips(edl, sceneClips);
    edl = withWordTimings(edl);

    // La preferencia del usuario manda sobre lo que devuelva el LLM/fallback: si los subtitulos
    // estan desactivados para este video, forzamos captions.enabled=false para que el render
    // (edl-to-ffmpeg + render-video.handler) no los queme.
    edl.captions.enabled = video.captionsEnabled;
    // El estilo lo decide el worker, no el LLM: el modelo no conoce las safe zones de YouTube ni los
    // requisitos de contraste, y devolvia cosas como fuente de 42px (ilegible en un movil).
    edl.captions.style = defaultCaptionStyle(video.format);

    const musicProvider = await resolveMusicProvider();
    if (musicProvider) {
      const track = await findBackgroundMusic(
        musicProvider,
        edl.audio.musicSuggestionTags ?? [],
        theme?.defaultMusicTags ?? [],
        Math.min(edl.totalDurationSeconds, 60),
      );
      if (track) {
        try {
          const musicPath = path.join(workspace, "background-music.mp3");
          await musicProvider.download(track, musicPath);
          edl.audio.backgroundMusicPath = musicPath;
          logger.info(`Background music selected for video ${videoId}`, {
            provider: musicProvider.name,
            track: track.title,
            attribution: track.attribution,
            musicSuggestionTags: edl.audio.musicSuggestionTags,
          });
        } catch (err) {
          logger.warn(`Failed to download background music for video ${videoId}, continuing without it`, {
            error: (err as Error).message,
          });
        }
      } else {
        logger.warn(`No background music found for video ${videoId}, continuing without it`);
      }
    }

    await db.update(videos).set({ edl, updatedAt: new Date() }).where(eq(videos.id, videoId));

    logger.info(`EDL built for video ${videoId}`, { scenes: edl.scenes.length });
    return { ...edl, costs: edlCost ? [edlCost] : [] };
  });

  await setVideoStatus(videoId, "rendering");
  const boss = await getBoss();
  await boss.send(QUEUES.RENDER_VIDEO, { videoId });
}
