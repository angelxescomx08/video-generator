import ffmpeg from "fluent-ffmpeg";

/** Concatenates same-format audio files (e.g. per-scene TTS wavs) into a single continuous track. */
export function concatAudioFiles(files: string[], destPath: string, tmpDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    for (const file of files) command.input(file);
    command
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .mergeToFile(destPath, tmpDir);
  });
}
