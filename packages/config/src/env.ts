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
  /**
   * Modelo de embeddings de Gemini. `text-embedding-004` fue RETIRADO (devuelve 404 en v1beta), asi
   * que el default es el vigente. `gemini-embedding-2` acepta 8192 tokens de entrada — cuatro veces
   * mas que nomic-embed-text — lo que reduce mucho el recorte de guiones largos.
   * Ambos devuelven 3072 dimensiones por defecto, pero se les pide 768 para que encajen con la
   * columna video_memory.embedding sin migrarla (ver gemini.provider.ts).
   */
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  TTS_PROVIDER: z.enum(["piper", "coqui", "elevenlabs", "azure", "google"]).default("piper"),
  TTS_BASE_URL: z.string().url().default("http://localhost:5002"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().optional(),
  AZURE_TTS_KEY: z.string().optional(),
  AZURE_TTS_REGION: z.string().optional(),
  GOOGLE_TTS_API_KEY: z.string().optional(),
  GOOGLE_TTS_VOICE_NAME: z.string().default("es-US-Neural2-A"),
  GOOGLE_TTS_LANGUAGE_CODE: z.string().default("es-US"),

  PIXABAY_API_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  SHUTTERSTOCK_API_KEY: z.string().optional(),
  SHUTTERSTOCK_API_SECRET: z.string().optional(),
  STORYBLOCKS_API_KEY: z.string().optional(),
  STORYBLOCKS_PRIVATE_KEY: z.string().optional(),
  STORYBLOCKS_PROJECT_ID: z.string().optional(),

  JAMENDO_CLIENT_ID: z.string().optional(),

  /**
   * Buscador web para proponer temas. Sin valor, el registry prueba en orden y usa el primero que
   * tenga credenciales (searxng -> tavily -> brave).
   */
  SEARCH_PROVIDER: z.enum(["tavily", "playwright", "brave", "wikipedia", "searxng"]).optional(),
  /** URL del SearXNG autohospedado. El docker-compose lo levanta en este puerto. */
  SEARXNG_URL: z.string().default("http://localhost:8888"),
  TAVILY_API_KEY: z.string().optional(),
  /**
   * Navegador que usa el buscador de Playwright. Vacio = prueba Edge, luego Chrome, luego el
   * Chromium propio de Playwright. En Windows los dos primeros ya estan instalados, asi que dejarlo
   * vacio no descarga nada; dentro del contenedor del worker no hay ninguno y hace falta el propio.
   */
  PLAYWRIGHT_BROWSER_CHANNEL: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),

  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().optional(),

  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_REDIRECT_URI: z.string().optional(),

  TOKEN_ENCRYPTION_KEY: z.string().min(16),

  RENDER_OUTPUT_DIR: z.string().default("./data/renders"),
  WORKER_TMP_DIR: z.string().default("./data/tmp"),
  /** Canciones subidas por el usuario. apps/web escribe aqui al subir y apps/worker lee al
   * renderizar, asi que igual que los otros dos debe ser una ruta ABSOLUTA compartida. */
  MUSIC_LIBRARY_DIR: z.string().default("./data/music"),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
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
