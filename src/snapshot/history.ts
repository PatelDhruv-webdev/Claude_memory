import { existsSync } from "node:fs";
import { mkdir, readdir, rename, unlink } from "node:fs/promises";
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
    // Caller doesn't want history; just remove the old one so the rename in
    // writeFileAtomic doesn't need to overwrite.
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
