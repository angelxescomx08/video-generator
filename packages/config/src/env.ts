import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PGBOSS_SCHEMA: z.string().default("pgboss"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  AI_PROVIDER: z.enum(["ollama", "openai", "gemini", "anthropic"]).default("ollama"),
  EMBEDDING_PROVIDER: z.enum(["ollama", "openai", "gemini"]).default("ollama"),

  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  GOOGLE_GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),

  TTS_PROVIDER: z.enum(["piper", "coqui", "elevenlabs", "azure"]).default("piper"),
  TTS_BASE_URL: z.string().url().default("http://localhost:5002"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().optional(),
  AZURE_TTS_KEY: z.string().optional(),
  AZURE_TTS_REGION: z.string().optional(),

  PIXABAY_API_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  SHUTTERSTOCK_API_KEY: z.string().optional(),
  SHUTTERSTOCK_API_SECRET: z.string().optional(),
  STORYBLOCKS_API_KEY: z.string().optional(),
  STORYBLOCKS_PRIVATE_KEY: z.string().optional(),
  STORYBLOCKS_PROJECT_ID: z.string().optional(),

  JAMENDO_CLIENT_ID: z.string().optional(),

  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().optional(),

  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_REDIRECT_URI: z.string().optional(),

  TOKEN_ENCRYPTION_KEY: z.string().min(16),

  RENDER_OUTPUT_DIR: z.string().default("./data/renders"),
  WORKER_TMP_DIR: z.string().default("./data/tmp"),
  FFMPEG_PATH: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
