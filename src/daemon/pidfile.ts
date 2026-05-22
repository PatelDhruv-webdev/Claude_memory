import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { writeFileAtomic } from "../util/atomic.js";

export interface PidRecord {
  pid: number;
  projectRoot: string;
  startedAt: string;
}

/**
 * Returns the live PID record, or null if no daemon is running.
 *
 * A "stale" PID file (process gone) is treated as no-daemon: we silently
 * remove it so the next start can proceed.
 */
export async function readLivePid(path: string): Promise<PidRecord | null> {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let rec: PidRecord;
  try {
    rec = JSON.parse(raw) as PidRecord;
  } catch {
    await safeUnlink(path);
    return null;
  }
  if (!isAlive(rec.pid)) {
    await safeUnlink(path);
    return null;
  }
  return rec;
}

export async function writePid(path: string, rec: PidRecord): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(rec, null, 2));
}

export async function clearPid(path: string): Promise<void> {
  await safeUnlink(path);
}

/**
 * Cross-platform liveness check: signal 0 doesn't deliver, but throws ESRCH
 * if the process doesn't exist. EPERM means the process exists but is owned
 * by someone else — count that as alive.
 */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore
  }
}
