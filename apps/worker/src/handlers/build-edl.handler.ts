import { resolveProvider } from "@video-generator/ai-providers";
import type { ScriptScene } from "@video-generator/ai-providers";
import { db, themes, videos } from "@video-generator/db";
import { resolveMusicProvider, type MusicProvider } from "@video-generator/music-providers";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { editDecisionListSchema, buildFallbackEdl, type EDLScene, type EditDecisionList } from "@video-generator/types";
import type { MusicTrackRef, StockClipRef } from "@video-generator/types";
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
 * Las escenas del EDL (venga del LLM o del fallback deterministico) traen su propia idea de
 * startSeconds/durationSeconds, pero el unico timing real es el de sceneAudio (duracion medida
 * del TTS ya concatenado en voiceoverPath). Sin este ajuste, subtitulos y cortes de video pueden
 * desincronizarse de la narracion real en cuanto el LLM estima mal una escena.
 */
function reconcileSceneTiming(edl: EditDecisionList, sceneAudio: SceneAudio[]): EditDecisionList {
  const sorted = [...sceneAudio].sort((a, b) => a.sceneIndex - b.sceneIndex);
  const timingByIndex = new Map<number, { startSeconds: number; durationSeconds: number }>();
  let cursor = 0;
  for (const sa of sorted) {
    timingByIndex.set(sa.sceneIndex, { startSeconds: cursor, durationSeconds: sa.durationSeconds });
    cursor += sa.durationSeconds;
  }

  const scenes = edl.scenes
    .filter((scene) => timingByIndex.has(scene.index))
    .map((scene): EDLScene => ({ ...scene, ...timingByIndex.get(scene.index)! }))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  return { ...edl, scenes, totalDurationSeconds: cursor };
}

/** Rellena captionWordTimings (si faltan) a partir del texto y el timing ya reconciliado de cada escena. */
function withWordTimings(edl: EditDecisionList): EditDecisionList {
  const scenes = edl.scenes.map((scene): EDLScene => {
    if (scene.captionWordTimings?.length || !scene.captionText) return scene;
    return {
      ...scene,
      captionWordTimings: estimateWordTimings(scene.captionText, scene.startSeconds, scene.durationSeconds),
    };
  });
  return { ...edl, scenes };
}

/** Prueba las tags del tema juntas, luego cada una por separado, y por ultimo tags genericas —
 * la musica de fondo es un extra, nunca debe tumbar la generacion del video. */
async function findBackgroundMusic(
  provider: MusicProvider,
  themeTags: string[],
  minDurationSeconds: number,
): Promise<MusicTrackRef | null> {
  const tagVariants: string[][] = [
    themeTags,
    ...themeTags.map((tag) => [tag]),
    GENERIC_MUSIC_TAGS,
  ].filter((tags) => tags.length > 0);

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
    try {
      const raw = await provider.generateEDL({
        scenes,
        availableClips: sceneClips.map((sc) => sc.clip),
        format: video.format,
        themeSlug: "",
      });
      const parsed = editDecisionListSchema.safeParse(raw);
      if (!parsed.success) throw new Error(parsed.error.message);
      edl = parsed.data;
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
    edl.scenes = edl.scenes.map((s) => {
      const clip = sceneClips.find((sc) => sc.sceneIndex === s.index);
      return clip ? { ...s, clip: { sourcePath: clip.localPath, mediaType: clip.clip.mediaType } } : s;
    });

    // Garantiza que cortes de escena y subtitulos queden sincronizados con el audio real (el LLM
    // solo vio duraciones estimadas del guion, no la duracion medida del TTS).
    edl = reconcileSceneTiming(edl, sceneAudio);
    edl = withWordTimings(edl);

    // La preferencia del usuario manda sobre lo que devuelva el LLM/fallback: si los subtitulos
    // estan desactivados para este video, forzamos captions.enabled=false para que el render
    // (edl-to-ffmpeg + render-video.handler) no los queme.
    edl.captions.enabled = video.captionsEnabled;

    const musicProvider = await resolveMusicProvider();
    if (musicProvider) {
      const track = await findBackgroundMusic(
        musicProvider,
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
    return edl;
  });

  await setVideoStatus(videoId, "rendering");
  const boss = await getBoss();
  await boss.send(QUEUES.RENDER_VIDEO, { videoId });
}
