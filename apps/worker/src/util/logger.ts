export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[info] ${msg}`, meta ?? ""),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[warn] ${msg}`, meta ?? ""),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[error] ${msg}`, meta ?? ""),
};
