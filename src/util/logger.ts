import pino, { type Logger } from "pino";
import { mkdirSync, createWriteStream } from "node:fs";
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

/**
 * Logger that writes JSON lines to a file. Used by the daemon, which has no
 * controlling terminal once detached.
 */
export function createFileLogger(path: string, level = "info"): Logger {
  mkdirSync(dirname(path), { recursive: true });
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
