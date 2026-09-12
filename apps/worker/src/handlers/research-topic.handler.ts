import { db, themes, topicProposals } from "@video-generator/db";
import { researchTopicPayloadSchema, type ResearchTopicPayload } from "@video-generator/queue";
import { eq } from "drizzle-orm";
import { researchTopic } from "../research/topic-research";
import { logger } from "../util/logger";

/** Reune material verificable de una idea elegible sin crear todavia un video. */
export async function handleResearchTopic(payload: ResearchTopicPayload): Promise<void> {
  const { proposalId } = researchTopicPayloadSchema.parse(payload);
  const proposal = await db.query.topicProposals.findFirst({ where: eq(topicProposals.id, proposalId) });
  if (!proposal) throw new Error(`Topic proposal ${proposalId} not found`);

  const theme = await db.query.themes.findFirst({ where: eq(themes.id, proposal.themeId) });
  if (!theme) throw new Error(`Theme ${proposal.themeId} not found`);

  await db.update(topicProposals).set({ researchStatus: "researching", updatedAt: new Date() }).where(eq(topicProposals.id, proposalId));
  try {
    const research = await researchTopic(theme.name, `${proposal.title}. ${proposal.idea}`);
    await db
      .update(topicProposals)
      .set({ researchSources: research.sources, researchCost: research.cost, researchStatus: "complete", updatedAt: new Date() })
      .where(eq(topicProposals.id, proposalId));
    logger.info(`Investigacion completada para propuesta ${proposalId}`, { sources: research.sources.length });
  } catch (error) {
    await db
      .update(topicProposals)
      .set({ researchStatus: "failed", updatedAt: new Date() })
      .where(eq(topicProposals.id, proposalId));
    throw error;
  }
}
