import { db, playbookRules } from "@video-generator/db";
import { and, eq, gt, isNull, or } from "drizzle-orm";

export interface PlaybookRuleForVideo { instruction: string; evidence: { metric: string; effectPoints: number; sampleSize: number; lowerBound?: number; upperBound?: number; guardrailsPassed: boolean }; }

/** Returns only current, evidence-backed rules whose declared scope matches this video. */
export async function getApplicablePlaybookRules(input: { themeId: string; format: "short" | "long"; targetDurationSeconds: number }): Promise<PlaybookRuleForVideo[]> {
  const rows = await db.select().from(playbookRules).where(and(eq(playbookRules.status, "active"), or(gt(playbookRules.expiresAt, new Date()), isNull(playbookRules.expiresAt))));
  return rows.filter((rule) => {
    const scope = rule.scope;
    return (!scope.formats || scope.formats.includes(input.format)) &&
      (!scope.themeIds || scope.themeIds.includes(input.themeId)) &&
      (scope.minDuration === undefined || input.targetDurationSeconds >= scope.minDuration) &&
      (scope.maxDuration === undefined || input.targetDurationSeconds <= scope.maxDuration);
  }).map((rule) => ({ instruction: rule.instruction, evidence: rule.evidence }));
}

