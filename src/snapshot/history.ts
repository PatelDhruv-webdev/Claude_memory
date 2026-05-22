import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { continuumDir, encodeProjectPath } from "../util/paths.js";

/**
 * Before overwriting HANDOFF.md, move the existing one to
 * ~/.continuum/history/<encoded-project>/HANDOFF-<ISO>.md and prune to
 * `keep` entries (oldest first).
 *
 * No-op when the source file doesn't exist.
 */
export async function rotateHandoff(
  projectRoot: string,
  currentHandoffPath: string,
  keep: number,
): Promise<void> {
  if (!existsSync(currentHandoffPath)) return;
  if (keep <= 0) {
    try {
      await unlink(currentHandoffPath);
    } catch {
      // ignore
    }
    return;
  }

  const encoded = encodeProjectPath(projectRoot);
  const dir = join(continuumDir(), "history", encoded);
  await mkdir(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(dir, `HANDOFF-${ts}.md`);
  await rename(currentHandoffPath, dest);

  await pruneHistory(dir, keep);
}

async function pruneHistory(dir: string, keep: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const handoffs = entries
    .filter((e) => e.startsWith("HANDOFF-") && e.endsWith(".md"))
    .sort(); // ISO timestamps sort chronologically
  if (handoffs.length <= keep) return;
  const toRemove = handoffs.slice(0, handoffs.length - keep);
  await Promise.all(
    toRemove.map((name) =>
      unlink(join(dir, name)).catch(() => {
        // ignore
      }),
    ),
  );
}

export interface HistoryEntry {
  name: string;
  path: string;
  timestamp: Date;
}

function historyDir(projectRoot: string): string {
  return join(continuumDir(), "history", encodeProjectPath(projectRoot));
}

function parseTimestamp(name: string): Date {
  // name: "HANDOFF-2026-05-22T21-27-01-840Z.md"
  const inner = name.slice("HANDOFF-".length, -".md".length);
  const tIdx = inner.indexOf("T");
  if (tIdx === -1) return new Date(0);
  const datePart = inner.slice(0, tIdx);
  const timePart = inner.slice(tIdx + 1);
  const m = timePart.match(/^(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return new Date(0);
  return new Date(`${datePart}T${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`);
}

/** List historical HANDOFF entries for a project, newest first. */
export async function listHistory(projectRoot: string): Promise<HistoryEntry[]> {
  const dir = historyDir(projectRoot);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.startsWith("HANDOFF-") && e.endsWith(".md"))
    .sort()
    .reverse() // most recent first
    .map((name) => ({ name, path: join(dir, name), timestamp: parseTimestamp(name) }));
}

/**
 * Read the content of the Nth historical HANDOFF entry (1 = most recent).
 * Returns null when index is out of range or the file is unreadable.
 */
export async function readHistoryEntry(
  projectRoot: string,
  index: number,
): Promise<string | null> {
  const entries = await listHistory(projectRoot);
  const entry = entries[index - 1];
  if (!entry) return null;
  try {
    return await readFile(entry.path, "utf8");
  } catch {
    return null;
  }
}

/** Delete all historical HANDOFF entries for a project. Returns the count removed. */
export async function clearHistory(projectRoot: string): Promise<number> {
  const entries = await listHistory(projectRoot);
  let removed = 0;
  for (const entry of entries) {
    try {
      await unlink(entry.path);
      removed++;
    } catch {
      // ignore
    }
  }
  return removed;
}
