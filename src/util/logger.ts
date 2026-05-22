import pino, { type Logger } from "pino";
import { mkdirSync, createWriteStream, existsSync, statSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export type { Logger };

export function createConsoleLogger(level = "info"): Logger {
  return pino({
    level,
    transport: undefined,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_KEEP = 3;

/**
 * Rotate the log file in place if it has exceeded `maxBytes`. Numbered
 * rotations: log.jsonl → log.jsonl.1 → log.jsonl.2 → ... → dropped.
 * Called once per logger creation (i.e. on daemon start), which is the
 * natural moment to rotate.
 */
export function rotateLogIfNeeded(
  path: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
  keep: number = DEFAULT_KEEP,
): void {
  if (!existsSync(path)) return;
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  if (size < maxBytes) return;

  // Cascade rotations from the oldest. log.jsonl.<keep-1> gets dropped;
  // log.jsonl.<n> moves to log.jsonl.<n+1>; log.jsonl → log.jsonl.1.
  for (let i = keep - 1; i >= 1; i--) {
    const from = `${path}.${i}`;
    const to = `${path}.${i + 1}`;
    if (!existsSync(from)) continue;
    if (i + 1 >= keep) {
      try { unlinkSync(from); } catch { /* ignore */ }
    } else {
      try { renameSync(from, to); } catch { /* ignore */ }
    }
  }
  try { renameSync(path, `${path}.1`); } catch { /* ignore */ }
}

/**
 * Logger that writes JSON lines to a file. Used by the daemon, which has no
 * controlling terminal once detached. Rotates oversized logs at creation
 * time so the file never grows unbounded across daemon restarts.
 */
export function createFileLogger(path: string, level = "info"): Logger {
  mkdirSync(dirname(path), { recursive: true });
  rotateLogIfNeeded(path);
  const stream = createWriteStream(path, { flags: "a" });
  return pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    stream,
  );
}
