CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "cost_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "cost_total_usd" numeric;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "cost_total_mxn" numeric;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "exchange_rate_used" numeric;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "video_version_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_video_version_id_video_versions_id_fk" FOREIGN KEY ("video_version_id") REFERENCES "public"."video_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
