import { z } from "zod";
import { DURATION_LIMITS } from "./duration";

export const createVideoRequestSchema = z
  .object({
    themeId: z.string().uuid(),
    format: z.enum(["long", "short"]),
    topic: z.string().min(1).optional(),
    /**
     * Techo de duracion en segundos, no un objetivo exacto: el video puede salir mas corto (hasta el
     * piso que deriva `resolveDurationBand`) pero no mas largo. Si no viene, se usa el default del
     * formato.
     */
    targetDurationSeconds: z.number().int().positive().optional(),
    autoPublish: z.boolean().default(false),
    captionsEnabled: z.boolean().default(false),
  })
  // Los limites dependen del formato (un Short de 10 minutos no existe), asi que no se pueden poner
  // como `.min()/.max()` en el campo: se validan cuando ya se sabe que formato se pidio. Se rechaza
  // en vez de recortar en silencio porque desde la API un valor fuera de rango es un error de quien
  // llama, no una preferencia a redondear.
  .superRefine((value, ctx) => {
    if (value.targetDurationSeconds === undefined) return;
    const limits = DURATION_LIMITS[value.format];
    if (value.targetDurationSeconds < limits.min || value.targetDurationSeconds > limits.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetDurationSeconds"],
        message: `Para formato "${value.format}" la duracion debe estar entre ${limits.min} y ${limits.max} segundos`,
      });
    }
  })
  .transform((value) => ({
    ...value,
    targetDurationSeconds: value.targetDurationSeconds ?? DURATION_LIMITS[value.format].default,
  }));
export type CreateVideoRequest = z.infer<typeof createVideoRequestSchema>;

export const createFeedbackRequestSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  structuredRatings: z.record(z.string(), z.number()).optional(),
  comment: z.string().optional(),
});
export type CreateFeedbackRequest = z.infer<typeof createFeedbackRequestSchema>;

export const regenerateVideoRequestSchema = z.object({
  feedbackId: z.string().uuid().optional(),
});
export type RegenerateVideoRequest = z.infer<typeof regenerateVideoRequestSchema>;

// `ScriptScene` vive en ./script, derivada del zod que valida el guion — una sola fuente de verdad.

export interface MemoryContextItem {
  content: string;
  contentType: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface FeedbackSummary {
  rating: number | null;
  comment: string | null;
  createdAt: Date;
}
