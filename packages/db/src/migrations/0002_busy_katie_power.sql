ALTER TABLE "videos" ADD COLUMN "captions_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "target_duration_seconds" integer;