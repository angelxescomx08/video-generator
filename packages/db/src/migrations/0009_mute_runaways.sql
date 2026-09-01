CREATE TABLE IF NOT EXISTS "learning_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"question" text NOT NULL,
	"buckets" text[] NOT NULL,
	"outcome" text NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "video_dimension_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_dimension_labels_video_dimension_key" UNIQUE("video_id","dimension_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_dimension_labels" ADD CONSTRAINT "video_dimension_labels_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_dimension_labels" ADD CONSTRAINT "video_dimension_labels_dimension_id_learning_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."learning_dimensions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_dimensions_status_idx" ON "learning_dimensions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_dimension_labels_dimension_idx" ON "video_dimension_labels" USING btree ("dimension_id");