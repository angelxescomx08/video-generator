import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "@video-generator/config";

/** Per-job scratch directory for downloaded clips, TTS audio, EDL intermediates, etc. */
export async function getJobWorkspace(videoId: string): Promise<string> {
  const env = loadEnv();
  const dir = path.join(env.WORKER_TMP_DIR, videoId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Cada version tiene su propio archivo bajo RENDER_OUTPUT_DIR/{videoId}/ para no pisar renders anteriores. */
export async function getRenderOutputPath(videoId: string, versionNumber: number): Promise<string> {
  const env = loadEnv();
  const dir = path.join(env.RENDER_OUTPUT_DIR, videoId);
  await mkdir(dir, { recursive: true });
  return path.join(dir, `v${versionNumber}.mp4`);
}
