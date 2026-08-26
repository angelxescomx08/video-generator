ALTER TABLE "video_stats" ADD COLUMN "source" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "video_age_days" integer;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "engaged_views" bigint;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "subscribers_gained" bigint;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "subscribers_lost" bigint;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "watch_time_hours" numeric;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "impressions_ctr" numeric;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "stayed_to_watch_percentage" numeric;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "retention_at_start_percentage" numeric;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "retention_curve" jsonb;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "traffic_sources" jsonb;--> statement-breakpoint
ALTER TABLE "video_stats" ADD COLUMN "notes" text;