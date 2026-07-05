import { z } from "zod";

export const sceneEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("ken_burns"),
    direction: z.enum(["in", "out"]),
    panX: z.enum(["left", "right", "center"]).optional(),
    panY: z.enum(["up", "down", "center"]).optional(),
  }),
  z.object({
    type: z.literal("zoom_punch"),
    intensity: z.enum(["low", "medium", "high"]),
  }),
]);
export type SceneEffect = z.infer<typeof sceneEffectSchema>;

export const sceneTransitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cut") }),
  z.object({ type: z.literal("crossfade"), durationSeconds: z.number().positive() }),
  z.object({ type: z.literal("fade_black"), durationSeconds: z.number().positive() }),
]);
export type SceneTransition = z.infer<typeof sceneTransitionSchema>;

export const captionWordTimingSchema = z.object({
  word: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
});
export type CaptionWordTiming = z.infer<typeof captionWordTimingSchema>;

export const captionStyleSchema = z.object({
  fontFamily: z.string(),
  fontSizePx: z.number().positive(),
  color: z.string(),
  highlightColor: z.string().optional(),
  position: z.enum(["bottom", "center", "top"]),
  backgroundBox: z.boolean().optional(),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const edlSceneSchema = z.object({
  index: z.number().int().nonnegative(),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  clip: z.object({
    sourcePath: z.string(),
    mediaType: z.enum(["video", "image"]),
  }),
  effect: sceneEffectSchema,
  transitionOut: sceneTransitionSchema,
  captionText: z.string().optional(),
  captionWordTimings: z.array(captionWordTimingSchema).optional(),
});
export type EDLScene = z.infer<typeof edlSceneSchema>;

export const editDecisionListSchema = z.object({
  version: z.literal(1),
  format: z.enum(["long", "short"]),
  totalDurationSeconds: z.number().positive(),
  audio: z.object({
    voiceoverPath: z.string(),
    backgroundMusicPath: z.string().optional(),
    backgroundMusicVolumeDb: z.number().optional(),
  }),
  captions: z.object({
    enabled: z.boolean(),
    style: captionStyleSchema,
  }),
  scenes: z.array(edlSceneSchema),
});
export type EditDecisionList = z.infer<typeof editDecisionListSchema>;

/** Default deterministic EDL used when LLM-generated EDL fails validation twice in a row. */
export function buildFallbackEdl(params: {
  format: "long" | "short";
  voiceoverPath: string;
  scenes: Array<{ sourcePath: string; mediaType: "video" | "image"; durationSeconds: number; captionText?: string }>;
}): EditDecisionList {
  let cursor = 0;
  const scenes: EDLScene[] = params.scenes.map((scene, index) => {
    const edlScene: EDLScene = {
      index,
      startSeconds: cursor,
      durationSeconds: scene.durationSeconds,
      clip: { sourcePath: scene.sourcePath, mediaType: scene.mediaType },
      effect: { type: "ken_burns", direction: index % 2 === 0 ? "in" : "out", panX: "center", panY: "center" },
      transitionOut:
        index === params.scenes.length - 1 ? { type: "cut" } : { type: "crossfade", durationSeconds: 0.5 },
      captionText: scene.captionText,
    };
    cursor += scene.durationSeconds;
    return edlScene;
  });

  return {
    version: 1,
    format: params.format,
    totalDurationSeconds: cursor,
    audio: { voiceoverPath: params.voiceoverPath },
    captions: {
      enabled: true,
      style: {
        fontFamily: "Arial",
        fontSizePx: params.format === "short" ? 64 : 42,
        color: "#FFFFFF",
        highlightColor: "#FFD700",
        position: "bottom",
        backgroundBox: true,
      },
    },
    scenes,
  };
}
