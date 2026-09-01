CREATE TABLE IF NOT EXISTS "dimension_discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"sample_count" integer NOT NULL,
	"proposed_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dimension_discovery_runs_started_idx" ON "dimension_discovery_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dimension_discovery_runs_status_idx" ON "dimension_discovery_runs" USING btree ("status");