export interface XfadeStep {
  /** Label of the running combined stream so far, e.g. "v0" then "vx0", "vx1"... */
  fromLabel: string;
  /** Label of the next scene's stream to blend in. */
  nextLabel: string;
  /** Output label for this step's combined stream. */
  outLabel: string;
  transition: "fade" | "fadeblack" | "fadewhite";
  durationSeconds: number;
  offsetSeconds: number;
}

/**
 * Builds one `xfade` filter invocation for chaining two scene streams. Callers chain multiple
 * steps sequentially (fromLabel of step N+1 = outLabel of step N) to combine N+1 scenes.
 *
 * NOTE: this is provided for future use (crossfade/fade_black transitions in the EDL). The
 * default render pipeline (see edl-to-ffmpeg.ts) currently uses simple `concat` between scenes
 * to keep audio/video perfectly in sync, since xfade's time-compressing overlap would require
 * also crossfading the voiceover track at matching offsets to avoid drift — tracked as a known
 * limitation in the README.
 */
export function buildXfadeStep(step: XfadeStep): string {
  return `[${step.fromLabel}][${step.nextLabel}]xfade=transition=${step.transition}:duration=${step.durationSeconds}:offset=${step.offsetSeconds}[${step.outLabel}]`;
}

/** Cumulative offsets for a chain of scene durations with per-transition overlap durations. */
export function computeXfadeOffsets(sceneDurations: number[], transitionDurations: number[]): number[] {
  const offsets: number[] = [];
  let runningLength = sceneDurations[0] ?? 0;
  for (let i = 0; i < transitionDurations.length; i++) {
    const t = transitionDurations[i]!;
    offsets.push(runningLength - t);
    runningLength = runningLength + (sceneDurations[i + 1] ?? 0) - t;
  }
  return offsets;
}
