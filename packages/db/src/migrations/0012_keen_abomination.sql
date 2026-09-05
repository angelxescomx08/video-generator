CREATE TABLE IF NOT EXISTS "topic_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"theme_id" uuid NOT NULL,
	"title" text NOT NULL,
	"idea" text NOT NULL,
	"angle" text NOT NULL,
	"sources" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"similarity_score" text,
	"similar_to_video_id" uuid,
	"created_video_id" uuid,
	"search_query" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topic_proposals" ADD CONSTRAINT "topic_proposals_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topic_proposals" ADD CONSTRAINT "topic_proposals_similar_to_video_id_videos_id_fk" FOREIGN KEY ("similar_to_video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topic_proposals" ADD CONSTRAINT "topic_proposals_created_video_id_videos_id_fk" FOREIGN KEY ("created_video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_proposals_status_idx" ON "topic_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_proposals_created_at_idx" ON "topic_proposals" USING btree ("created_at" DESC NULLS LAST);