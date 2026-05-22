import { startWatcher, type WatcherEvent } from "../daemon/watcher.js";
import {
  decide,
  initialState,
  type TriggerConfig,
  type TriggerState,
} from "../daemon/triggers.js";
import { detectSessionEnd } from "../daemon/session-end.js";
import { snapshot } from "../snapshot/index.js";
import { extractState } from "../snapshot/extract.js";
import { claudeCodeSource } from "../sources/claude-code.js";
import { digest } from "../llm/digest.js";
import type { Config } from "../config/schema.js";
import { open } from "node:fs/promises";

const DEBOUNCE_MS = 1_000;
const TICK_MS = 5_000;

export interface WatchOptions {
  projectRoot: string;
  config: Config;
  out?: NodeJS.WritableStream;
}

/**
 * Foreground watcher: like the daemon but attached to the current terminal.
 * Prints human-readable events to `out` (default: process.stderr) and exits
 * cleanly on SIGINT/SIGTERM/SIGHUP with a final snapshot.
 */
export async function runWatch(opts: WatchOptions): Promise<void> {
  const out = opts.out ?? process.stderr;
  const log = (msg: string) => out.write(`continuum: ${msg}\n`);

  log(`watching ${opts.projectRoot}`);
  log(`idle trigger: ${opts.config.triggers.idle_minutes} min | error trigger: ${opts.config.triggers.on_error}`);

  const cfg: TriggerConfig = {
    idleMs: opts.config.triggers.idle_minutes * 60_000,
    debounceMs: DEBOUNCE_MS,
    enableIdle: opts.config.triggers.on_idle,
    enableError: opts.config.triggers.on_error,
    enableExit: opts.config.triggers.on_exit,
  };

  let state: TriggerState = initialState();
  let inFlight = false;

  const fire = async (reason: string): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      log(`snapshot triggered (${reason})`);
      const file = await claudeCodeSource.discover(opts.projectRoot);
      if (!file) {
        log("skipped: no session file found");
        return;
      }
      const ss = await extractState(claudeCodeSource.parse(file), {
        lastTurns: opts.config.snapshot.last_turns,
      });
      const dig = await digest(ss, opts.config);
      if (dig.error) log(`digest skipped: ${dig.error}`);
      const res = await snapshot({
        cwd: opts.projectRoot,
        config: opts.config,
        narrative: dig.narrative,
      });
      log(`wrote ${res.handoffPath}`);
    } catch (err) {
      log(`snapshot failed: ${(err as Error).message}`);
    } finally {
      inFlight = false;
    }
  };

  const onEvent = async (e: WatcherEvent) => {
    if (e.type === "session-rotated") {
      log(`session rotated: ${e.path ?? ""}`);
      return;
    }
    if (e.type === "no-session") {
      log("no session file found yet");
      return;
    }

    const d = decide(state, { kind: "change", at: Date.now() }, cfg);
    state = d.nextState;

    // Check for error/session-end in the last 16 KB of the session file.
    if (e.path) {
      await maybeFireOnError(e.path, cfg, () => state, (s) => { state = s; }, log, fire);
    }
  };

  const stopWatcher = await startWatcher({
    projectRoot: opts.projectRoot,
    onEvent,
    onError: (err) => log(`watcher error: ${err.message}`),
  });

  const tick = setInterval(async () => {
    const d = decide(state, { kind: "tick", at: Date.now() }, cfg);
    if (d.fire && !inFlight) {
      state = d.nextState;
      await fire(d.reason ?? "idle");
    } else {
      state = d.nextState;
    }
  }, TICK_MS);

  const cleanup = async (reason: string) => {
    clearInterval(tick);
    try {
      await stopWatcher();
    } catch {
      // ignore
    }
    if (cfg.enableExit) {
      await fire(`exit (${reason})`);
    }
    log("stopped");
  };

  const onSignal = (sig: NodeJS.Signals) => {
    void cleanup(sig).then(() => process.exit(0));
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("SIGHUP", onSignal);

  log("press Ctrl+C to stop and write a final snapshot");
  // Keep alive — timers do the work.
}

async function maybeFireOnError(
  sessionFile: string,
  cfg: TriggerConfig,
  getState: () => TriggerState,
  setState: (s: TriggerState) => void,
  log: (msg: string) => void,
  fire: (reason: string) => Promise<void>,
): Promise<void> {
  let tail: string;
  try {
    const fd = await open(sessionFile, "r");
    try {
      const { size } = await fd.stat();
      const start = Math.max(0, size - 16 * 1024);
      const buf = Buffer.alloc(size - start);
      await fd.read(buf, 0, buf.length, start);
      tail = buf.toString("utf8");
    } finally {
      await fd.close();
    }
  } catch {
    return;
  }

  const end = detectSessionEnd(tail);
  if (end.ended) {
    const d = decide(getState(), { kind: "error", at: Date.now() }, cfg);
    setState(d.nextState);
    if (d.fire) await fire(`session_end:${end.reason}`);
    return;
  }

  if (!cfg.enableError) return;
  if (!tail.includes('"is_error":true')) return;

  const d = decide(getState(), { kind: "error", at: Date.now() }, cfg);
  setState(d.nextState);
  if (d.fire) await fire("error");
}
