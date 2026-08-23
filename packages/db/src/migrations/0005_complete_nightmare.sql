CREATE TABLE IF NOT EXISTS "music_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"artist" text,
	"file_path" text NOT NULL,
	"original_filename" text,
	"mime_type" text,
	"size_bytes" integer,
	"duration_seconds" integer,
	"genres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"moods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attribution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
