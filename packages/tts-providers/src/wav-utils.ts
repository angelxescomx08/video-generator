/** Reads duration in seconds from a canonical PCM WAV header (no external deps needed). */
export function readWavDurationSeconds(buffer: Buffer): number {
  const byteRate = buffer.readUInt32LE(28);
  const dataSize = buffer.readUInt32LE(40);
  if (byteRate === 0) return 0;
  return dataSize / byteRate;
}
