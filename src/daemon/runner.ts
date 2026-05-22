import { writePid, clearPid, readLivePid } from "./pidfile.js";
import { startWatcher, type WatcherEvent } from "./watcher.js";
import { decide, initialState, type TriggerConfig, type TriggerState } from "./triggers.js";
import { detectSessionEnd } from "./session-end.js";
import { snapshot } from "../snapshot/index.js";
import { extractState } from "../snapshot/extract.js";
import { claudeCodeSource } from "../sources/claude-code.js";
import { digest } from "../llm/digest.js";
import type { Config } from "../config/schema.js";
import { pidPath, logPath } from "../util/paths.js";
import { createFileLogger, type Logger } from "../util/logger.js";
import { DaemonError } from "../util/errors.js";

const DEBOUNCE_MS = 1_000;
const TICK_MS = 5_000;

export interface RunnerOptions {
  projectRoot: string;
  config: Config;
}

export async function runDaemon(opts: RunnerOptions): Promise<void> {
  const pid = pidPath();
  const existing = await readLivePid(pid);
  if (existing) {
    throw new DaemonError(
      `Daemon already running (PID ${existing.pid}, project ${existing.projectRoot}).`,
      "Run `continuum stop` first, or use `continuum status` to inspect it.",
    );
  }

  const log = createFileLogger(logPath(), opts.config.log_level);
  log.info({ event: "daemon.start", projectRoot: opts.projectRoot, pid: process.pid });

  await writePid(pid, {
    pid: process.pid,
    projectRoot: opts.projectRoot,
    startedAt: new Date().toISOString(),
  });

  const cfg: TriggerConfig = {
    idleMs: opts.config.triggers.idle_minutes * 60_000,
    debounceMs: DEBOUNCE_MS,
    enableIdle: opts.config.triggers.on_idle,
    enableError: opts.config.triggers.on_error,
    enableExit: opts.config.triggers.on_exit,
  };
  let state: TriggerState = initialState();
  let inFlight = false;

  const onEvent = async (e: WatcherEvent) => {
    if (e.type === "session-rotated") {
      log.info({ event: "session.rotated", path: e.path });
      return;
    }
    if (e.type === "no-session") {
      log.warn({ event: "session.missing" });
      return;
    }

    // It's a "change". Decide if we fire.
    const d = decide(state, { kind: "change", at: Date.now() }, cfg);
    state = d.nextState;

    // Also peek at the most recent events to detect errors.
    await maybeFireOnError(opts, e.path!, cfg, () => state, (s) => (state = s), log, () => inFlight, (b) => (inFlight = b));
  };

  const stopWatcher = await startWatcher({
    projectRoot: opts.projectRoot,
    onEvent,
    onError: (err) => log.error({ event: "watcher.error", err: err.message }),
  });

  const tick = setInterval(async () => {
    const d = decide(state, { kind: "tick", at: Date.now() }, cfg);
    if (d.fire && !inFlight) {
      inFlight = true;
      try {
        log.info({ event: "trigger.fire", reason: d.reason });
        await fireSnapshot(opts, log);
        state = d.nextState;
      } catch (err) {
        log.error({ event: "snapshot.error", err: (err as Error).message });
      } finally {
        inFlight = false;
      }
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
    if (cfg.enableExit && !inFlight) {
      try {
        log.info({ event: "trigger.fire", reason: "exit" });
        await fireSnapshot(opts, log);
      } catch (err) {
        log.error({ event: "snapshot.error.onexit", err: (err as Error).message });
      }
    }
    await clearPid(pid);
    log.info({ event: "daemon.stop", reason });
  };

  const onSignal = (sig: NodeJS.Signals) => {
    void cleanup(sig).then(() => process.exit(0));
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("SIGHUP", onSignal);

  // Keep alive — the timers do the work.
}

async function fireSnapshot(opts: RunnerOptions, log: Logger): Promise<void> {
  // Run extract once so we can also send it through the LLM digest,
  // then write everything in one go.
  const source = claudeCodeSource;
  const file = await source.discover(opts.projectRoot);
  if (!file) {
    log.warn({ event: "snapshot.skip", reason: "no session file" });
    return;
  }
  const state = await extractState(source.parse(file), {
    lastTurns: opts.config.snapshot.last_turns,
  });
  const dig = await digest(state, opts.config);
  if (dig.error) log.warn({ event: "digest.skip", reason: dig.error });

  const res = await snapshot({
    cwd: opts.projectRoot,
    config: opts.config,
    narrative: dig.narrative,
  });
  log.info({ event: "snapshot.write", handoff: res.handoffPath });
}

async function maybeFireOnError(
  opts: RunnerOptions,
  sessionFile: string,
  cfg: TriggerConfig,
  getState: () => TriggerState,
  setState: (s: TriggerState) => void,
  log: Logger,
  getInFlight: () => boolean,
  setInFlight: (b: boolean) => void,
): Promise<void> {
  // Read the tail once; use it for both error detection AND session-end detection.
  let tail: string;
  try {
    const { open } = await import("node:fs/promises");
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

  // Terminal stop reason / rate limit: fire immediately as an "error" trigger.
  // The decision engine debounces so we won't double-fire.
  const end = detectSessionEnd(tail);
  if (end.ended) {
    const d = decide(getState(), { kind: "error", at: Date.now() }, cfg);
    setState(d.nextState);
    if (d.fire && !getInFlight()) {
      setInFlight(true);
      try {
        log.info({ event: "trigger.fire", reason: `session_end:${end.reason}` });
        await fireSnapshot(opts, log);
      } catch (err) {
        log.error({ event: "snapshot.error", err: (err as Error).message });
      } finally {
        setInFlight(false);
      }
    }
    return;
  }

  // Tool error in the last 16 KB.
  if (!cfg.enableError) return;
  if (!tail.includes('"is_error":true')) return;

  const d = decide(getState(), { kind: "error", at: Date.now() }, cfg);
  setState(d.nextState);
  if (d.fire && !getInFlight()) {
    setInFlight(true);
    try {
      log.info({ event: "trigger.fire", reason: "error" });
      await fireSnapshot(opts, log);
    } catch (err) {
      log.error({ event: "snapshot.error", err: (err as Error).message });
    } finally {
      setInFlight(false);
    }
  }
}
