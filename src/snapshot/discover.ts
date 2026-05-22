import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { claudeProjectsDir, encodeProjectPath } from "../util/paths.js";

export async function discoverSession(projectRoot: string): Promise<string | null> {
  const encoded = encodeProjectPath(projectRoot);
  const dir = join(claudeProjectsDir(), encoded);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const candidates = entries.filter(
    (name) => name.endsWith(".jsonl") && !name.startsWith("agent-"),
  );
  if (candidates.length === 0) return null;

  const withStats = await Promise.all(
    candidates.map(async (name) => {
      const full = join(dir, name);
      const s = await stat(full);
      return { full, mtime: s.mtimeMs };
    }),
  );

  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats[0]!.full;
}
