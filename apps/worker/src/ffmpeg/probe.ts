import { spawn } from "node:child_process";
import path from "node:path";
import { loadEnv } from "@video-generator/config";

/** ffprobe suele vivir junto a ffmpeg; si FFMPEG_PATH apunta a un binario concreto, deriva su hermano. */
function resolveFfprobeBin(): string {
  const env = loadEnv();
  if (env.FFPROBE_PATH) return env.FFPROBE_PATH;
  if (env.FFMPEG_PATH) {
    const dir = path.dirname(env.FFMPEG_PATH);
    const ext = path.extname(env.FFMPEG_PATH);
    if (dir && dir !== ".") return path.join(dir, `ffprobe${ext}`);
  }
  return "ffprobe";
}

/**
 * Mide la duracion real de un archivo de audio/video con ffprobe.
 *
 * Necesario porque varios proveedores de TTS (Google, ElevenLabs, Azure) devuelven
 * `durationSeconds: 0` — solo Piper/Coqui la derivan del header WAV. Sin esta medicion todas las
 * escenas quedan con duracion 0, lo que dejaba los eventos ASS de subtitulos con duracion cero
 * (libass no dibuja nada) y la duracion del video en 0.
 */
export function probeDurationSeconds(filePath: string): Promise<number> {
  const bin = resolveFfprobeBin();
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code} for ${filePath}: ${stderr.trim()}`));
        return;
      }
      const seconds = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(seconds) || seconds <= 0) {
        reject(new Error(`ffprobe returned an unusable duration for ${filePath}: "${stdout.trim()}"`));
        return;
      }
      resolve(seconds);
    });
  });
}
