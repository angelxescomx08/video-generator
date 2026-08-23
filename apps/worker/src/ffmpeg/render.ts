import { spawn } from "node:child_process";
import { loadEnv } from "@video-generator/config";
import { logger } from "../util/logger";

/** Cuantas lineas finales de stderr se guardan para incluirlas en el error si ffmpeg falla. */
const STDERR_TAIL_LINES = 25;

/** ffmpeg devuelve el errno negativo, que en Windows llega como uint32 (-2 -> 4294967294). */
function describeExitCode(code: number): string {
  const signed = code > 2147483647 ? code - 4294967296 : code;
  const known: Record<number, string> = {
    [-2]: "ENOENT: ffmpeg no encontro uno de los archivos de entrada (revisa que las rutas existan y sean absolutas)",
    [-13]: "EACCES: permiso denegado sobre un archivo de entrada o salida",
    [-28]: "ENOSPC: no queda espacio en disco",
  };
  const hint = known[signed];
  return hint ? `${code} (${signed} — ${hint})` : `${code}${signed !== code ? ` (${signed})` : ""}`;
}

export function runFfmpeg(args: string[], onProgress?: (line: string) => void): Promise<void> {
  const env = loadEnv();
  const ffmpegBin = env.FFMPEG_PATH || "ffmpeg";

  return new Promise((resolve, reject) => {
    // -hide_banner: sin esto el volcado de version/configuration de ffmpeg (unas 12 lineas) llena
    // la cola de stderr y desplaza justamente el mensaje de error que interesa.
    const child = spawn(ffmpegBin, ["-hide_banner", ...args]);
    // ffmpeg escribe TODO por stderr (progreso y errores). Antes solo se reenviaba a onProgress,
    // que filtra por "time=", asi que el mensaje de error real se perdia y solo quedaba el codigo
    // de salida — imposible de diagnosticar. Ahora se conserva la cola para el mensaje de error.
    const stderrTail: string[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (onProgress) onProgress(text);
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        stderrTail.push(trimmed);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderrTail.join("\n");
      logger.error(`ffmpeg fallo (codigo ${code})`, { stderr: detail });
      reject(new Error(`ffmpeg exited with code ${describeExitCode(code ?? -1)}\n${detail}`));
    });
  });
}

export function logFfmpegProgress(videoId: string) {
  return (line: string) => {
    const match = line.match(/time=(\d\d:\d\d:\d\d\.\d\d)/);
    if (match) logger.info(`Render progress video=${videoId} time=${match[1]}`);
  };
}
