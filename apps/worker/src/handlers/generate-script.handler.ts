import { resolveProvider } from "@video-generator/ai-providers";
import { db, FACT_TYPES, generationHistory, themes, videos, type FactType } from "@video-generator/db";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { computeWordBudget, resolveDurationBand, type CostItem } from "@video-generator/types";
import { eq } from "drizzle-orm";
import { storeMemory } from "../memory/embed";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
import { clampScenesToWordBudget } from "../prompts/clamp-scenes-duration";
import { buildScriptGenerationRequest } from "../prompts/script-prompt.builder";
import { logger } from "../util/logger";

export async function handleGenerateScript(payload: VideoJobPayload): Promise<void> {
  const { videoId } = videoJobPayloadSchema.parse(payload);

  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  const theme = await db.query.themes.findFirst({ where: eq(themes.id, video.themeId) });
  if (!theme) throw new Error(`Theme ${video.themeId} not found`);

  await runStage(videoId, STAGES.script!, async () => {
    const provider = await resolveProvider();
    const { request, exploration, cost: memoryCost } = await buildScriptGenerationRequest(theme, video);
    // Se guarda antes de generar: si el experimento es de pipeline, quien lo aplica es el stage del
    // EDL, y para entonces esta funcion ya no existe.
    await db.update(videos).set({ explorationPlan: exploration }).where(eq(videos.id, videoId));
    const { result, cost: scriptCost } = await provider.generateScript(request);

    // Red de seguridad sin costo de tokens extra: si el LLM ignoro el limite de palabras del
    // prompt, recorta las escenas aqui mismo en vez de pedirle al LLM que lo intente de nuevo.
    const { maxWords } = computeWordBudget(resolveDurationBand(video.format, video.targetDurationSeconds));
    const scenes = clampScenesToWordBudget(result.scenes, maxWords);
    if (scenes !== result.scenes) {
      logger.warn(`Guion recortado por exceder el presupuesto de palabras para video ${videoId}`, {
        maxWords,
        originalScenes: result.scenes.length,
      });
    }

    await db
      .update(videos)
      .set({
        title: result.title,
        description: result.description,
        script: result.script,
        scenes,
        tags: result.tags,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));

    // El LLM puede devolver hechos malformados (factType nulo/desconocido o factValue
    // vacio). Ambas columnas son NOT NULL y factType esta acotado a FACT_TYPES, asi que
    // descartamos lo invalido antes de insertar en vez de dejar que reviente el INSERT.
    const validFactTypes = new Set<string>(FACT_TYPES);
    const factsToInsert = (result.extractedFacts ?? [])
      .filter((f) => validFactTypes.has(f?.factType) && typeof f?.factValue === "string" && f.factValue.trim() !== "")
      .map((f) => ({
        themeId: theme.id,
        videoId,
        factType: f.factType as FactType,
        factValue: f.factValue.trim(),
      }));

    const skipped = (result.extractedFacts?.length ?? 0) - factsToInsert.length;
    if (skipped > 0) {
      logger.warn(`Descartados ${skipped} hechos invalidos del LLM para video ${videoId}`);
    }

    if (factsToInsert.length > 0) {
      await db.insert(generationHistory).values(factsToInsert).onConflictDoNothing();
    }

    const storeCost = await storeMemory({
      themeId: theme.id,
      videoId,
      contentType: "script",
      content: result.script,
      metadata: { title: result.title, tags: result.tags },
    });

    const costs: CostItem[] = [memoryCost, scriptCost, storeCost].map((c) => ({ ...c, stage: "script" }));

    logger.info(`Script generated for video ${videoId}`, { title: result.title });
    return { ...result, scenes, costs };
  });

  await setVideoStatus(videoId, "generating_tts");
  const boss = await getBoss();
  await boss.send(QUEUES.GENERATE_TTS, { videoId });
}
