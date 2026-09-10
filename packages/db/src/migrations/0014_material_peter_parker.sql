CREATE TABLE IF NOT EXISTS "learning_experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"block_key" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_experiment_assignments_video_id_unique" UNIQUE("video_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text NOT NULL,
	"scope" jsonb NOT NULL,
	"primary_metric" text NOT NULL,
	"guardrails" jsonb NOT NULL,
	"control_label" text NOT NULL,
	"treatment_label" text NOT NULL,
	"treatment_instruction" text NOT NULL,
	"min_effect_points" numeric NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playbook_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid,
	"instruction" text NOT NULL,
	"scope" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'validating' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_experiment_assignments" ADD CONSTRAINT "learning_experiment_assignments_experiment_id_learning_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."learning_experiments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_experiment_assignments" ADD CONSTRAINT "learning_experiment_assignments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_rules" ADD CONSTRAINT "playbook_rules_experiment_id_learning_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."learning_experiments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_experiment_assignments_experiment_idx" ON "learning_experiment_assignments" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_experiments_status_idx" ON "learning_experiments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_rules_status_idx" ON "playbook_rules" USING btree ("status");