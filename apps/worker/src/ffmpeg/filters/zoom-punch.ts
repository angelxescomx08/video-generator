import type { SceneEffect } from "@video-generator/types";

export interface ZoomPunchFilterParams {
  effect: Extract<SceneEffect, { type: "zoom_punch" }>;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
}

const INTENSITY_TO_PEAK: Record<ZoomPunchFilterParams["effect"]["intensity"], number> = {
  low: 1.08,
  medium: 1.15,
  high: 1.25,
};

/** Quick zoom-in-then-settle punch, peaking near the middle of the scene, for emphasis beats. */
export function buildZoomPunchFilter(params: ZoomPunchFilterParams): string {
  const { effect, durationSeconds, fps, width, height } = params;
  const frames = Math.max(1, Math.round(durationSeconds * fps));
  const peak = INTENSITY_TO_PEAK[effect.intensity];
  const peakFrame = Math.round(frames * 0.4);

  // Ramp 1.0 -> peak over the first 40% of the scene, then ease back to 1.05 for the remainder.
  const z = `if(lte(on,${peakFrame}),1+((${peak}-1)*on/${peakFrame}),${peak}-((${peak}-1.05)*(on-${peakFrame})/${frames - peakFrame}))`;

  return `zoompan=z='${z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`;
}
