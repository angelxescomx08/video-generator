import { resolveProvider } from "@video-generator/ai-providers";
import { db, generationHistory, themes, videos } from "@video-generator/db";
import { getBoss, QUEUES, videoJobPayloadSchema, type VideoJobPayload } from "@video-generator/queue";
import { eq } from "drizzle-orm";
import { storeMemory } from "../memory/embed";
import { runStage, setVideoStatus } from "../pipeline/orchestrator";
import { STAGES } from "../pipeline/stage-context";
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
    const request = await buildScriptGenerationRequest(theme, video);
    const result = await provider.generateScript(request);

    await db
      .update(videos)
      .set({
        title: result.title,
        description: result.description,
        script: result.script,
        scenes: result.scenes,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));

    if (result.extractedFacts.length > 0) {
      await db
        .insert(generationHistory)
        .values(
          result.extractedFacts.map((f) => ({
            themeId: theme.id,
            videoId,
            factType: f.factType as (typeof generationHistory.$inferInsert)["factType"],
            factValue: f.factValue,
          })),
        )
        .onConflictDoNothing();
    }

    await storeMemory({
      themeId: theme.id,
      videoId,
      contentType: "script",
      content: result.script,
      metadata: { title: result.title, tags: result.tags },
    });

    logger.info(`Script generated for video ${videoId}`, { title: result.title });
    return result;
  });

  await setVideoStatus(videoId, "generating_tts");
  const boss = await getBoss();
  await boss.send(QUEUES.GENERATE_TTS, { videoId });
}
