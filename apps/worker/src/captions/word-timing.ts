import type { CaptionWordTiming } from "@video-generator/types";

/**
 * Distributes a scene's actual (TTS-measured) duration across its caption words, weighted by
 * word length as a proxy for spoken duration — there's no per-word ASR/alignment step in this
 * pipeline. Feeds the karaoke-style `\k` highlighting in srt-builder.ts. Pure function, no I/O —
 * unit-testable directly.
 */
export function estimateWordTimings(
  text: string,
  startSeconds: number,
  durationSeconds: number,
): CaptionWordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const weights = words.map((w) => w.length + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let cursor = startSeconds;
  return words.map((word, i) => {
    const wordDuration = (weights[i]! / totalWeight) * durationSeconds;
    const wordStart = cursor;
    cursor += wordDuration;
    return { word, startSeconds: wordStart, endSeconds: cursor };
  });
}
