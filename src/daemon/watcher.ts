import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { stat } from "node:fs/promises";
import { claudeProjectsDir, encodeProjectPath } from "../util/paths.js";
import { discoverSession } from "../snapshot/discover.js";

export interface WatcherEvent {
  type: "change" | "session-rotated" | "no-session";
  path: string | null;
  size?: number;
}

export interface WatcherOptions {
  projectRoot: string;
  /** Polling interval used as a fallback (e.g. on network filesystems). */
  pollMs?: number;
  /** Force polling regardless of platform. Useful for tests / NFS / VMs. */
  forcePolling?: boolean;
  onEvent: (e: WatcherEvent) => void;
  onError?: (err: Error) => void;
}

/**
 * Watches the Claude Code project directory for JSONL changes and emits
 * events on the current session file. If the session file changes (Claude
 * Code rotates), emits `session-rotated` and re-targets.
 *
 * Returns a function to stop the watcher.
 */
export async function startWatcher(opts: WatcherOptions): Promise<() => Promise<void>> {
  const projectDir = join(claudeProjectsDir(), encodeProjectPath(opts.projectRoot));

  let currentSession = await discoverSession(opts.projectRoot);
  if (!currentSession) opts.onEvent({ type: "no-session", path: null });

  const watcher: FSWatcher = chokidar.watch(projectDir, {
    persistent: true,
    ignoreInitial: true,
    usePolling: opts.forcePolling ?? false,
    interval: opts.pollMs ?? 1_000,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignored: (path) => path.includes("/agent-"),
  });

  const handle = async (filePath: string) => {
    if (!filePath.endsWith(".jsonl")) return;

    // Re-discover the newest session in case rotation happened.
    const newest = await discoverSession(opts.projectRoot);
    if (!newest) {
      opts.onEvent({ type: "no-session", path: null });
      return;
    }
    if (newest !== currentSession) {
      currentSession = newest;
      opts.onEvent({ type: "session-rotated", path: newest });
    }
    if (filePath !== currentSession) return;
    try {
      const s = await stat(filePath);
      opts.onEvent({ type: "change", path: filePath, size: s.size });
    } catch {
      // file may have just been rotated; ignore
    }
  };

  watcher.on("add", handle);
  watcher.on("change", handle);
  watcher.on("error", (err) => {
    if (opts.onError) opts.onError(err as Error);
  });

  return async () => {
    await watcher.close();
  };
}
