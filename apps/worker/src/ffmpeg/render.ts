import { spawn } from "node:child_process";
import { loadEnv } from "@video-generator/config";
import { logger } from "../util/logger";

export function runFfmpeg(args: string[], onProgress?: (line: string) => void): Promise<void> {
  const env = loadEnv();
  const ffmpegBin = env.FFMPEG_PATH || "ffmpeg";

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, args);

    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      if (onProgress) onProgress(line);
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

export function logFfmpegProgress(videoId: string) {
  return (line: string) => {
    const match = line.match(/time=(\d\d:\d\d:\d\d\.\d\d)/);
    if (match) logger.info(`Render progress video=${videoId} time=${match[1]}`);
  };
}
