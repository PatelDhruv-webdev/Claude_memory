import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readLivePid, clearPid, type PidRecord } from "./pidfile.js";
import { pidPath, logPath } from "../util/paths.js";
import { DaemonError } from "../util/errors.js";
import { sleep } from "../util/retry.js";

/**
 * Spawn a detached child running `continuum --__daemon-internal` so the
 * shell can exit without killing the watcher.
 */
export async function spawnDaemon(projectRoot: string): Promise<PidRecord> {
  const existing = await readLivePid(pidPath());
  if (existing) {
    throw new DaemonError(
      `Daemon already running (PID ${existing.pid}, project ${existing.projectRoot}).`,
      "Run `continuum stop` first.",
    );
  }

  // Resolve our own CLI entrypoint. tsup writes dist/cli.js next to this file.
  const here = dirname(fileURLToPath(import.meta.url));
  const cliPath = resolve(here, "cli.js");

  const child = spawn(process.execPath, [cliPath, "__daemon-internal", projectRoot], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  // Poll for the PID file the child writes once it's up.
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const rec = await readLivePid(pidPath());
    if (rec && rec.pid === child.pid) return rec;
  }
  throw new DaemonError(
    "Spawned daemon did not register a PID file in time.",
    `Check ${logPath()} for errors.`,
  );
}

export async function stopDaemon(): Promise<{ stopped: boolean; pid?: number }> {
  const rec = await readLivePid(pidPath());
  if (!rec) return { stopped: false };
  try {
    process.kill(rec.pid, "SIGTERM");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      await clearPid(pidPath());
      return { stopped: false };
    }
    throw err;
  }
  // Wait up to 5s for it to exit.
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const still = await readLivePid(pidPath());
    if (!still) return { stopped: true, pid: rec.pid };
  }
  // Force.
  try {
    process.kill(rec.pid, "SIGKILL");
  } catch {
    // ignore
  }
  await clearPid(pidPath());
  return { stopped: true, pid: rec.pid };
}

export async function statusDaemon(): Promise<{ running: boolean; record?: PidRecord }> {
  const rec = await readLivePid(pidPath());
  if (!rec) return { running: false };
  return { running: true, record: rec };
}
