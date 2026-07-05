import type { SceneEffect } from "@video-generator/types";

export interface ZoomFilterParams {
  effect: Extract<SceneEffect, { type: "ken_burns" }>;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
}

/**
 * Builds a `zoompan` filter that slowly zooms in/out and pans, applied uniformly to both still
 * images (fed as a looped frame) and video clips (zoompan works frame-by-frame with d=1).
 */
export function buildKenBurnsFilter(params: ZoomFilterParams): string {
  const { effect, durationSeconds, fps, width, height } = params;
  const frames = Math.max(1, Math.round(durationSeconds * fps));

  const zoomStart = effect.direction === "in" ? 1.0 : 1.15;
  const zoomEnd = effect.direction === "in" ? 1.15 : 1.0;
  const z = `${zoomStart}+((${zoomEnd}-${zoomStart})*on/${frames})`;

  const xExpr =
    effect.panX === "left" ? "0" : effect.panX === "right" ? "iw-iw/zoom" : "iw/2-(iw/zoom/2)";
  const yExpr =
    effect.panY === "up" ? "0" : effect.panY === "down" ? "ih-ih/zoom" : "ih/2-(ih/zoom/2)";

  return `zoompan=z='${z}':d=1:x='${xExpr}':y='${yExpr}':s=${width}x${height}:fps=${fps}`;
}
