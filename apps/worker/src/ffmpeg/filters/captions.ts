/** Escapes a filesystem path so it's safe to embed inside an ffmpeg filtergraph string (esp. on Windows). */
function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

export function buildCaptionsFilter(assFilePath: string): string {
  return `ass='${escapeFilterPath(assFilePath)}'`;
}
