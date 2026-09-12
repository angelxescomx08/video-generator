ALTER TABLE "videos" ADD COLUMN "topic_research_sources" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "topic_research_cost" jsonb;--> statement-breakpoint
ALTER TABLE "topic_proposals" ADD COLUMN "research_sources" jsonb;--> statement-breakpoint
ALTER TABLE "topic_proposals" ADD COLUMN "research_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "topic_proposals" ADD COLUMN "research_cost" jsonb;