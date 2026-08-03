import { createReadStream, statSync, type ReadStream } from "node:fs";

/** Envuelve un fs.ReadStream en un ReadableStream web, tolerando que el reader cancele a medias
 * (seek/cierre de pestana en el <video>) sin tumbar el proceso con "Controller is already closed". */
function nodeStreamToWebReadable(nodeStream: ReadStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
        } catch {
          // El reader ya cancelo el stream (cliente cerro/hizo seek) — no hay nada que encolar.
        }
      });
      nodeStream.on("end", () => {
        try {
          controller.close();
        } catch {
          // Ya estaba cerrado por cancel() — ignorar.
        }
      });
      nodeStream.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          // Ya estaba cerrado — ignorar.
        }
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

/** Sirve un archivo de video con soporte de HTTP Range (206 Partial Content) — necesario para que
 * el <video> del navegador pueda hacer seek sin descargar el archivo completo cada vez. */
export function videoFileResponse(filePath: string, rangeHeader: string | null): Response {
  const stat = statSync(filePath);
  const fileSize = stat.size;

  let start = 0;
  let end = fileSize - 1;
  let status = 200;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
  };

  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
  if (match) {
    const [, startStr, endStr] = match;
    if (startStr) start = Number(startStr);
    if (endStr) end = Number(endStr);

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
  }

  headers["Content-Length"] = String(end - start + 1);

  const nodeStream = createReadStream(filePath, { start, end });
  return new Response(nodeStreamToWebReadable(nodeStream), { status, headers });
}
