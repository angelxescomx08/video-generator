import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { videos } from "./videos";

export const EXPERIMENT_STATUSES = ["draft", "validating", "confirmed", "rejected", "retired"] as const;
export const PLAYBOOK_RULE_STATUSES = ["validating", "active", "paused", "retired"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export type PlaybookRuleStatus = (typeof PLAYBOOK_RULE_STATUSES)[number];

/** A pre-registered comparison: one controlled change, one primary outcome and explicit guardrails. */
export const learningExperiments = pgTable("learning_experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  scope: jsonb("scope").notNull().$type<{ formats?: Array<"short" | "long">; themeIds?: string[]; minDuration?: number; maxDuration?: number; }> (),
  primaryMetric: text("primary_metric").notNull(),
  guardrails: jsonb("guardrails").notNull().$type<Array<{ metric: string; maxRegressionPoints: number }>>(),
  controlLabel: text("control_label").notNull(),
  treatmentLabel: text("treatment_label").notNull(),
  treatmentInstruction: text("treatment_instruction").notNull(),
  minEffectPoints: numeric("min_effect_points").notNull(),
  status: text("status").notNull().default("draft").$type<ExperimentStatus>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("learning_experiments_status_idx").on(t.status)]);

/** The assignment is immutable: it answers which exact variant a video was asked to use. */
export const learningExperimentAssignments = pgTable("learning_experiment_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  experimentId: uuid("experiment_id").notNull().references(() => learningExperiments.id),
  videoId: uuid("video_id").notNull().references(() => videos.id).unique(),
  variant: text("variant").notNull().$type<"control" | "treatment">(),
  blockKey: text("block_key").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("learning_experiment_assignments_experiment_idx").on(t.experimentId)]);

/** A reversible, scoped rule passed to the generator only after evidence is recorded. */
export const playbookRules = pgTable("playbook_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  experimentId: uuid("experiment_id").references(() => learningExperiments.id),
  instruction: text("instruction").notNull(),
  scope: jsonb("scope").notNull().$type<{ formats?: Array<"short" | "long">; themeIds?: string[]; minDuration?: number; maxDuration?: number; }> (),
  evidence: jsonb("evidence").notNull().$type<{ metric: string; effectPoints: number; sampleSize: number; lowerBound?: number; upperBound?: number; guardrailsPassed: boolean }>(),
  status: text("status").notNull().default("validating").$type<PlaybookRuleStatus>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("playbook_rules_status_idx").on(t.status)]);
