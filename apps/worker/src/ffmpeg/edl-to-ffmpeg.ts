import type { EditDecisionList } from "@video-generator/types";
import { buildCaptionsFilter } from "./filters/captions";
import { buildKenBurnsFilter } from "./filters/ken-burns";
import { buildZoomPunchFilter } from "./filters/zoom-punch";

export interface Resolution {
  width: number;
  height: number;
}

export const FPS = 30;

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
    if (scene.clip.mediaType === "image") {
      args.push("-loop", "1", "-framerate", String(FPS), "-t", String(scene.durationSeconds), "-i", scene.clip.sourcePath);
    } else {
      args.push("-i", scene.clip.sourcePath);
    }

    const preLabel = `v${i}pre`;
    const trimPart =
      scene.clip.mediaType === "video"
        ? `trim=duration=${scene.durationSeconds},setpts=PTS-STARTPTS,`
        : "";
    filterParts.push(
      `[${i}:v]${trimPart}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${FPS}[${preLabel}]`,
    );

    const outLabel = `v${i}`;
    if (scene.effect.type === "ken_burns") {
      filterParts.push(
        `[${preLabel}]${buildKenBurnsFilter({ effect: scene.effect, durationSeconds: scene.durationSeconds, fps: FPS, width, height })}[${outLabel}]`,
      );
    } else if (scene.effect.type === "zoom_punch") {
      filterParts.push(
        `[${preLabel}]${buildZoomPunchFilter({ effect: scene.effect, durationSeconds: scene.durationSeconds, fps: FPS, width, height })}[${outLabel}]`,
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

  let finalAudioMapArg = `${voiceoverInputIndex}:a`;
  if (options.backgroundMusicPath) {
    const musicInputIndex = voiceoverInputIndex + 1;
    args.push("-i", options.backgroundMusicPath);
    const musicVolumeLinear = Math.pow(10, (edl.audio.backgroundMusicVolumeDb ?? -18) / 20);
    filterParts.push(
      `[${musicInputIndex}:a]volume=${musicVolumeLinear},aloop=loop=-1:size=2e9[musicloop]`,
      `[${voiceoverInputIndex}:a][musicloop]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
    );
    finalAudioMapArg = "[aout]";
  }

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
