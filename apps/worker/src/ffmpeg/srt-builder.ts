import { writeFile } from "node:fs/promises";
import type { CaptionStyle, EDLScene } from "@video-generator/types";

function toAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds - Math.floor(seconds)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function hexToAssColor(hex: string): string {
  const clean = hex.replace("#", "");
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function alignmentFor(position: CaptionStyle["position"]): number {
  if (position === "top") return 8;
  if (position === "center") return 5;
  return 2;
}

/** Builds a karaoke-style word-highlight caption line using ASS \k tags, or a plain line if no word timings. */
function buildCaptionText(scene: EDLScene, style: CaptionStyle): string {
  if (scene.captionWordTimings && scene.captionWordTimings.length > 0) {
    return scene.captionWordTimings
      .map((w) => {
        const centiseconds = Math.round((w.endSeconds - w.startSeconds) * 100);
        const word = style.highlightColor
          ? `{\\kf${centiseconds}}${w.word}`
          : `{\\k${centiseconds}}${w.word}`;
        return word;
      })
      .join(" ");
  }
  return scene.captionText ?? "";
}

export async function buildAssSubtitleFile(params: {
  scenes: EDLScene[];
  style: CaptionStyle;
  resolutionWidth: number;
  resolutionHeight: number;
  destPath: string;
}): Promise<string> {
  const { scenes, style, resolutionWidth, resolutionHeight, destPath } = params;

  const primaryColor = hexToAssColor(style.color);
  const highlightColor = style.highlightColor ? hexToAssColor(style.highlightColor) : primaryColor;
  const alignment = alignmentFor(style.position);
  const backColor = style.backgroundBox ? "&H64000000" : "&H00000000";

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${resolutionWidth}
PlayResY: ${resolutionHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${style.fontSizePx},${primaryColor},${highlightColor},&H00000000,${backColor},0,0,0,0,100,100,0,0,${style.backgroundBox ? 3 : 1},2,0,${alignment},20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = scenes
    .filter((s) => s.captionText || s.captionWordTimings?.length)
    .map((s) => {
      const text = buildCaptionText(s, style);
      return `Dialogue: 0,${toAssTime(s.startSeconds)},${toAssTime(s.startSeconds + s.durationSeconds)},Default,,0,0,0,,${text}`;
    })
    .join("\n");

  await writeFile(destPath, header + events + "\n", "utf-8");
  return destPath;
}
