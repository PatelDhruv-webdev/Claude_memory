import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { encodeProjectPath } from "../src/util/paths.js";

const exec = promisify(execFile);

const CLI = resolve(__dirname, "..", "dist", "cli.js");
const FIXTURES = join(__dirname, "fixtures");

/**
 * End-to-end test of the daemon. We:
 *  1. Build the CLI (once).
 *  2. Point HOME at a fresh tmpdir so the pidfile, log, config, and
 *     ~/.claude/projects all live under our test sandbox.
 *  3. Write a config with mode=factual_only so no LLM is invoked.
 *  4. Plant a session JSONL.
 *  5. Spawn `node dist/cli.js __daemon-internal <projectRoot>`, wait for
 *     the pidfile, then SIGTERM and assert HANDOFF.md was produced by the
 *     exit trigger.
 */
describe("daemon end-to-end", () => {
  let fakeHome: string;
  let projectRoot: string;
  let sessionsDir: string;
  let child: ChildProcess | null = null;
  const realHome = process.env.HOME;

  beforeAll(async () => {
    if (!existsSync(CLI)) {
      // Build is required before this suite. Run it once if missing.
      await exec("pnpm", ["build"], { cwd: resolve(__dirname, "..") });
    }
  }, 60_000);

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "continuum-int-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "continuum-int-proj-"));
    sessionsDir = join(fakeHome, ".claude", "projects", encodeProjectPath(projectRoot));
    await mkdir(sessionsDir, { recursive: true });

    // Write a minimal config so the daemon doesn't fall back to defaults
    // (defaults set mode=local_llm which would try to reach Ollama).
    const continuumDir = join(fakeHome, ".continuum");
    await mkdir(continuumDir, { recursive: true });
    await writeFile(
      join(continuumDir, "config.yml"),
      [
        "schema_version: 1",
        "mode: factual_only",
        "local_llm:",
        "  base_url: http://localhost:11434/v1",
        "  model: qwen2.5:3b",
        "  timeout_seconds: 60",
        "external_api:",
        "  base_url: https://api.anthropic.com",
        "  api_key_env: ANTHROPIC_API_KEY",
        "  model: claude-haiku-4-5-20251001",
        "  provider: anthropic",
        "triggers:",
        "  on_error: true",
        "  on_idle: true",
        "  idle_minutes: 5",
        "  on_exit: true",
        "snapshot:",
        "  handoff_filename: HANDOFF.md",
        "  diff_filename: HANDOFF.diff",
        "  last_turns: 8",
        "  keep_history: 5",
        "watch:",
        "  project_root: auto",
        "log_level: info",
      ].join("\n") + "\n",
    );
  });

  afterEach(async () => {
    if (child && !child.killed) {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }
    child = null;
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    await rm(fakeHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function spawnDaemonChild(): ChildProcess {
    return spawn(process.execPath, [CLI, "__daemon-internal", projectRoot], {
      env: { ...process.env, HOME: fakeHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (existsSync(path)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  it("produces HANDOFF.md on SIGTERM (exit trigger)", async () => {
    await copyFile(
      join(FIXTURES, "session-clean-end.jsonl"),
      join(sessionsDir, "session.jsonl"),
    );

    child = spawnDaemonChild();
    const pidPath = join(fakeHome, ".continuum", "daemon.pid");
    expect(await waitForFile(pidPath, 5_000)).toBe(true);

    // Append a change so the watcher sees activity (not strictly required for
    // the exit trigger, but exercises the watcher path).
    await appendFile(
      join(sessionsDir, "session.jsonl"),
      "\n" + JSON.stringify({
        type: "user",
        message: { role: "user", content: "another message" },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 500));

    child.kill("SIGTERM");
    // Wait for HANDOFF.md to appear (cleanup writes it on exit).
    expect(await waitForFile(join(projectRoot, "HANDOFF.md"), 5_000)).toBe(true);
    const md = await readFile(join(projectRoot, "HANDOFF.md"), "utf8");
    expect(md).toContain("# Session Handoff");
    expect(md).toContain("## Goal");

    // pidfile should be cleared by the cleanup handler.
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(pidPath)).toBe(false);
  }, 15_000);

  it("refuses to start a second daemon while one is live", async () => {
    await copyFile(
      join(FIXTURES, "session-clean-end.jsonl"),
      join(sessionsDir, "session.jsonl"),
    );
    child = spawnDaemonChild();
    const pidPath = join(fakeHome, ".continuum", "daemon.pid");
    expect(await waitForFile(pidPath, 5_000)).toBe(true);

    // Try `start` — it should fail because the pidfile is alive.
    let exitCode: number | null = null;
    let stderr = "";
    try {
      await exec(process.execPath, [CLI, "start"], {
        env: { ...process.env, HOME: fakeHome },
        cwd: projectRoot,
      });
    } catch (err) {
      const e = err as { code?: number; stderr?: string };
      exitCode = e.code ?? null;
      stderr = e.stderr ?? "";
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/already running/i);

    child.kill("SIGTERM");
  }, 15_000);
});
