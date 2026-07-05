import type { ScriptGenerationRequest } from "@video-generator/ai-providers";
import type { Theme, Video } from "@video-generator/db";
import { getAvoidFacts, getRecentFeedback, retrieveMemoryContext } from "../memory/retrieve";

const REPEATABLE_FACT_TYPES = ["bible_verse_used", "quote_used", "title_used"] as const;

export async function buildScriptGenerationRequest(theme: Theme, video: Video): Promise<ScriptGenerationRequest> {
  const queryText = `${theme.name} ${video.topic ?? ""}`.trim();

  const [memoryContext, avoidFacts, recentFeedback] = await Promise.all([
    retrieveMemoryContext(theme.id, queryText),
    getAvoidFacts(theme.id, [...REPEATABLE_FACT_TYPES]),
    getRecentFeedback(theme.id),
  ]);

  return {
    themeSlug: theme.slug,
    systemPrompt: theme.systemPrompt,
    userPromptTemplate: theme.scriptPromptTemplate,
    topic: video.topic ?? undefined,
    format: video.format,
    targetDurationSeconds: video.format === "short" ? 45 : 300,
    memoryContext,
    avoidFacts,
    recentFeedback,
  };
}
