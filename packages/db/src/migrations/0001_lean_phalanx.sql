CREATE TABLE IF NOT EXISTS "video_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"script" text,
	"scenes" jsonb,
	"scene_audio" jsonb,
	"scene_clips" jsonb,
	"edl" jsonb,
	"render_output_path" text NOT NULL,
	"duration_seconds" integer,
	"triggered_by_feedback_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "pending_feedback_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_triggered_by_feedback_id_feedback_id_fk" FOREIGN KEY ("triggered_by_feedback_id") REFERENCES "public"."feedback"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_versions_video_version_idx" ON "video_versions" USING btree ("video_id","version_number");