import { DEFAULT_BACKGROUND_MUSIC_DB, type EditDecisionList } from "@video-generator/types";
import { buildCaptionsFilter } from "./filters/captions";
import { buildKenBurnsFilter } from "./filters/ken-burns";
import { buildZoomPunchFilter } from "./filters/zoom-punch";

export interface Resolution {
  width: number;
  height: number;
}

export const FPS = 30;

/**
 * Redondea una duracion HACIA ARRIBA al frame siguiente.
 *
 * ffmpeg solo puede emitir frames enteros, asi que pedirle 9.17s a 30fps (275.1 frames) devuelve 274
 * frames = 9.133s: cada escena sale ~1 frame corta. Sumado sobre todas las escenas el video acaba
 * antes que el voiceover y el ultimo subtitulo se recorta.
 *
 * Se redondea hacia arriba, nunca hacia abajo, porque las dos direcciones no cuestan lo mismo: un
 * video ligeramente MAS LARGO que el audio solo deja el ultimo frame quieto un instante, mientras que
 * uno mas corto se lleva imagen y subtitulos. El desfase acumulado (< 1 frame por escena) mueve
 * levemente los cortes de b-roll respecto a la narracion, pero NO mueve los subtitulos: esos van
 * cronometrados en tiempo absoluto sobre el voiceover, que se mapea aparte.
 */
export function frameAlignedDuration(seconds: number): number {
  return Math.ceil(seconds * FPS) / FPS;
}

export function resolutionForFormat(format: "long" | "short"): Resolution {
  return format === "short" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

export interface FfmpegBuildOptions {
  /** Path to a pre-built .ass subtitle file (see srt-builder.ts), or undefined to skip captions. */
  assFilePath?: string;
  /** Background music track path, if any (mixed under the voiceover). */
  backgroundMusicPath?: string;
  outputPath: string;
}

/**
 * Pure function: EDL + a few resolved file paths -> full ffmpeg argv. No I/O, no process spawn —
 * unit-testable by asserting on the returned array. See render.ts for the process execution.
 *
 * Scene chaining uses `concat` (not `xfade`) to guarantee the pre-built voiceover track (which is
 * a straight concatenation of per-scene TTS clips, see build-edl.handler.ts) stays frame-accurate
 * in sync with the video. EDL `transitionOut` values are preserved in the data model for a future
 * xfade-based pipeline (see filters/crossfade.ts) but are not yet applied to the video stream.
 */
export function buildFfmpegArgs(edl: EditDecisionList, options: FfmpegBuildOptions): string[] {
  const { width, height } = resolutionForFormat(edl.format);
  const args: string[] = [];
  const filterParts: string[] = [];

  edl.scenes.forEach((scene, i) => {
    // Se usa la duracion alineada a frame en TODOS los sitios donde se le pide a ffmpeg una longitud,
    // para que la entrada, el trim y los efectos midan exactamente lo mismo.
    const sceneDuration = frameAlignedDuration(scene.durationSeconds);

    if (scene.clip.mediaType === "image") {
      args.push("-loop", "1", "-framerate", String(FPS), "-t", String(sceneDuration), "-i", scene.clip.sourcePath);
    } else {
      // `-stream_loop -1` + `-t duracion` garantiza que la escena aporte EXACTAMENTE su duracion de
      // video, repitiendo el clip si hace falta.
      //
      // Sin el loop, un clip de stock mas corto que su escena aportaba solo su propia longitud
      // (`trim=duration` recorta, pero no puede alargar), asi que el video terminaba mas corto que el
      // voiceover. Medido en un caso real: video 67.4s contra audio 74.4s. Los ultimos 7 segundos se
      // quedaban con voz pero sin imagen, y como los subtitulos se queman SOBRE el stream de video,
      // tambien desaparecian ahi — se veia como si el video se cortara solo al final.
      //
      // El `-t` a la entrada es lo que corta el bucle infinito: sin el, `-stream_loop -1` seguiria
      // alimentando el grafo para siempre.
      args.push("-stream_loop", "-1", "-t", String(sceneDuration), "-i", scene.clip.sourcePath);
    }

    const preLabel = `v${i}pre`;
    const trimPart =
      scene.clip.mediaType === "video"
        ? `trim=duration=${sceneDuration},setpts=PTS-STARTPTS,`
        : "";
    filterParts.push(
      `[${i}:v]${trimPart}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${FPS}[${preLabel}]`,
    );

    const outLabel = `v${i}`;
    if (scene.effect.type === "ken_burns") {
      filterParts.push(
        `[${preLabel}]${buildKenBurnsFilter({ effect: scene.effect, durationSeconds: sceneDuration, fps: FPS, width, height })}[${outLabel}]`,
      );
    } else if (scene.effect.type === "zoom_punch") {
      filterParts.push(
        `[${preLabel}]${buildZoomPunchFilter({ effect: scene.effect, durationSeconds: sceneDuration, fps: FPS, width, height })}[${outLabel}]`,
      );
    } else {
      filterParts.push(`[${preLabel}]null[${outLabel}]`);
    }
  });

  const concatInputs = edl.scenes.map((_, i) => `[v${i}]`).join("");
  filterParts.push(`${concatInputs}concat=n=${edl.scenes.length}:v=1:a=0[vconcat]`);

  let finalVideoLabel = "vconcat";
  if (edl.captions.enabled && options.assFilePath) {
    filterParts.push(`[vconcat]${buildCaptionsFilter(options.assFilePath)}[vcaptioned]`);
    finalVideoLabel = "vcaptioned";
  }

  const voiceoverInputIndex = edl.scenes.length;
  args.push("-i", edl.audio.voiceoverPath);

  // -14 LUFS integrado / -1 dBTP de pico verdadero: el target oficial de YouTube. YouTube solo
  // BAJA el audio si supera esto (nunca lo sube), asi que mezclar por debajo suena mas flojo que
  // el resto de la plataforma — normalizar aqui evita tener que ajustar el volumen a mano despues.
  const LOUDNORM_FILTER = "loudnorm=I=-14:TP=-1:LRA=11";

  let premixLabel = `${voiceoverInputIndex}:a`;
  if (options.backgroundMusicPath) {
    const musicInputIndex = voiceoverInputIndex + 1;
    args.push("-i", options.backgroundMusicPath);
    const musicVolumeLinear = Math.pow(10, (edl.audio.backgroundMusicVolumeDb ?? DEFAULT_BACKGROUND_MUSIC_DB) / 20);
    filterParts.push(
      `[${musicInputIndex}:a]volume=${musicVolumeLinear},aloop=loop=-1:size=2e9[musicloop]`,
      `[${voiceoverInputIndex}:a][musicloop]amix=inputs=2:duration=first:dropout_transition=2[amixed]`,
    );
    premixLabel = "amixed";
  }
  filterParts.push(`[${premixLabel}]${LOUDNORM_FILTER}[aout]`);
  const finalAudioMapArg = "[aout]";

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    `[${finalVideoLabel}]`,
    "-map",
    finalAudioMapArg,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-r",
    String(FPS),
    "-y",
    options.outputPath,
  );

  return args;
}
