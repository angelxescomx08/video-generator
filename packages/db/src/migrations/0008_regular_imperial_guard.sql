CREATE INDEX IF NOT EXISTS "videos_created_at_idx" ON "videos" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_theme_idx" ON "videos" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_status_idx" ON "videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_versions_created_at_idx" ON "video_versions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_jobs_video_version_idx" ON "generation_jobs" USING btree ("video_id","video_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_jobs_video_created_idx" ON "generation_jobs" USING btree ("video_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_memory_theme_idx" ON "video_memory" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_memory_embedding_idx" ON "video_memory" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_theme_created_idx" ON "feedback" USING btree ("theme_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_created_at_idx" ON "feedback" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_video_idx" ON "feedback" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "published_videos_video_idx" ON "published_videos" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "published_videos_status_idx" ON "published_videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_stats_published_captured_idx" ON "video_stats" USING btree ("published_video_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_stats_captured_idx" ON "video_stats" USING btree ("captured_at" DESC NULLS LAST);