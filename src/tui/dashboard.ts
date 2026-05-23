import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readLivePid } from "../daemon/pidfile.js";
import { tailLines } from "../util/tail.js";
import { pidPath, logPath } from "../util/paths.js";
import { getGitInfo } from "../snapshot/git.js";
import { claudeCodeSource } from "../sources/claude-code.js";
import { extractState } from "../snapshot/extract.js";
import type { Config } from "../config/schema.js";
import { ansi, boxTop, boxDivider, boxRow, boxBottom } from "./boxes.js";

const VERSION = "0.1.0";
const REFRESH_MS = 2_000;
const LOG_LINES = 8;

export interface DashboardOptions {
  projectRoot: string;
  config: Config;
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

interface DaemonInfo {
  running: boolean;
  pid?: number;
  project?: string;
  startedAt?: string;
}

interface SessionInfo {
  goal?: string;
  fileCount: number;
  commandCount: number;
  errorCount: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  branch?: string;
  stopReason?: string | null;
  hasSession: boolean;
}

interface SnapshotMeta {
  generatedAt?: string;
  stopReason?: string | null;
  tokensIn?: number;
  cacheRead?: number;
  branch?: string;
}

interface DashData {
  daemon: DaemonInfo;
  session: SessionInfo;
  lastSnapshot: SnapshotMeta | null;
  logLines: string[];
  refreshedAt: Date;
}

async function gatherData(opts: DashboardOptions): Promise<DashData> {
  const [daemonResult, logResult, sessionResult, snapshotResult] =
    await Promise.allSettled([
      fetchDaemon(),
      fetchLogs(),
      fetchSession(opts),
      fetchSnapshot(opts),
    ]);

  return {
    daemon:       daemonResult.status === "fulfilled" ? daemonResult.value : { running: false },
    logLines:     logResult.status === "fulfilled" ? logResult.value : [],
    session:      sessionResult.status === "fulfilled" ? sessionResult.value : emptySession(),
    lastSnapshot: snapshotResult.status === "fulfilled" ? snapshotResult.value : null,
    refreshedAt:  new Date(),
  };
}

async function fetchDaemon(): Promise<DaemonInfo> {
  const rec = await readLivePid(pidPath());
  if (!rec) return { running: false };
  return { running: true, pid: rec.pid, project: rec.projectRoot, startedAt: rec.startedAt };
}

async function fetchLogs(): Promise<string[]> {
  if (!existsSync(logPath())) return [];
  const raw = await tailLines(logPath(), LOG_LINES);
  return raw.filter((l) => l.trim().length > 0);
}

function emptySession(): SessionInfo {
  return { fileCount: 0, commandCount: 0, errorCount: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, hasSession: false };
}

async function fetchSession(opts: DashboardOptions): Promise<SessionInfo> {
  const file = await claudeCodeSource.discover(opts.projectRoot);
  if (!file) return emptySession();

  const [state, git] = await Promise.all([
    extractState(claudeCodeSource.parse(file), { lastTurns: 0 }),
    getGitInfo(opts.projectRoot),
  ]);

  return {
    hasSession:   true,
    goal:         state.goal || undefined,
    fileCount:    state.filesTouched.size,
    commandCount: state.commands.length,
    errorCount:   state.errors.length,
    tokensIn:     state.tokenUsage.input,
    tokensOut:    state.tokenUsage.output,
    cacheRead:    state.tokenUsage.cacheRead,
    branch:       git.branch,
    stopReason:   state.stopReason,
  };
}

async function fetchSnapshot(opts: DashboardOptions): Promise<SnapshotMeta | null> {
  const path = join(opts.projectRoot, opts.config.snapshot.handoff_filename);
  if (!existsSync(path)) return null;
  const content = await readFile(path, "utf8");
  const fm = parseFrontmatter(content);
  if (!fm) return null;
  return {
    generatedAt: fm["generated_at"],
    stopReason:  fm["stop_reason"] === "null" ? null : fm["stop_reason"],
    tokensIn:    fm["tokens_in"] ? Number(fm["tokens_in"]) : undefined,
    cacheRead:   fm["cache_read"] ? Number(fm["cache_read"]) : undefined,
    branch:      fm["branch"],
  };
}

function parseFrontmatter(md: string): Record<string, string> | null {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m || !m[1]) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor((ms % 60_000) / 1_000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m === 0) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function fmtLogLine(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const time = obj["time"] ? new Date(obj["time"] as number).toISOString().slice(11, 19) : "??:??:??";
    const event = (obj["event"] as string | undefined) ?? "";
    const extras: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (["level", "time", "pid", "hostname", "event"].includes(k)) continue;
      extras.push(`${k}=${String(v)}`);
    }
    return [time, event, ...extras].filter(Boolean).join("  ");
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(data: DashData, width: number): string {
  const rows: string[] = [];
  const r = (content: string) => rows.push(boxRow(content, width));
  const blank = () => rows.push(boxRow("", width));

  rows.push(boxTop({ width, title: `continuum  v${VERSION}` }));

  // ── Daemon ──────────────────────────────────────────────────────────────
  if (data.daemon.running) {
    const uptime = data.daemon.startedAt
      ? `  uptime ${fmtUptime(data.daemon.startedAt)}`
      : "";
    r(`${ansi.green}${ansi.bold}● RUNNING${ansi.reset}  PID ${data.daemon.pid}${uptime}`);
    if (data.daemon.project) {
      r(`${ansi.gray}project: ${ansi.reset}${data.daemon.project}`);
    }
  } else {
    r(`${ansi.red}○ STOPPED${ansi.reset}  ${ansi.gray}run ${ansi.cyan}continuum start${ansi.gray} to begin watching${ansi.reset}`);
  }

  if (data.lastSnapshot?.generatedAt) {
    r(`${ansi.gray}last snapshot: ${ansi.reset}${fmtRelative(data.lastSnapshot.generatedAt)}`);
  } else {
    r(`${ansi.gray}last snapshot: ${ansi.reset}none yet`);
  }

  // ── Session ──────────────────────────────────────────────────────────────
  rows.push(boxDivider(width, "Session"));
  if (!data.session.hasSession) {
    blank();
    r(`${ansi.gray}No active Claude Code session found in this project.${ansi.reset}`);
    r(`${ansi.gray}Start a Claude Code session in ${data.daemon.project ?? "this directory"}.${ansi.reset}`);
    blank();
  } else {
    const goal = data.session.goal ?? "(no user message yet)";
    r(`${ansi.bold}Goal:${ansi.reset} ${goal}`);
    blank();

    const errColor = data.session.errorCount > 0 ? ansi.red : ansi.reset;
    const stats = [
      `${ansi.cyan}files${ansi.reset}    ${data.session.fileCount}`,
      `${ansi.cyan}commands${ansi.reset} ${data.session.commandCount}`,
      `${errColor}errors${ansi.reset}   ${data.session.errorCount}`,
      data.session.branch
        ? `${ansi.cyan}branch${ansi.reset}   ${data.session.branch}`
        : "",
    ].filter(Boolean).join("   ");
    r(stats);

    if (data.session.tokensIn > 0) {
      const tok = `${ansi.cyan}tokens${ansi.reset}   ${fmtNum(data.session.tokensIn)} in / ${fmtNum(data.session.tokensOut)} out`;
      const cache = data.session.cacheRead > 0
        ? `   ${ansi.cyan}cache read${ansi.reset} ${fmtNum(data.session.cacheRead)}`
        : "";
      r(tok + cache);
    }

    if (data.session.stopReason) {
      r(`${ansi.yellow}stop reason: ${data.session.stopReason}${ansi.reset}`);
    }
  }

  // ── Log ──────────────────────────────────────────────────────────────────
  rows.push(boxDivider(width, `Recent Log  (last ${LOG_LINES} lines)`));
  if (data.logLines.length === 0) {
    blank();
    r(`${ansi.gray}No log entries yet. Start the daemon with ${ansi.cyan}continuum start${ansi.gray}.${ansi.reset}`);
    blank();
  } else {
    for (const line of data.logLines) {
      r(`${ansi.gray}${fmtLogLine(line)}${ansi.reset}`);
    }
  }

  // ── Last Snapshot ────────────────────────────────────────────────────────
  rows.push(boxDivider(width, "Last Snapshot"));
  if (!data.lastSnapshot) {
    blank();
    r(`${ansi.gray}No HANDOFF.md found yet. Run ${ansi.cyan}continuum snapshot${ansi.gray} to generate one.${ansi.reset}`);
    blank();
  } else {
    const snap = data.lastSnapshot;
    if (snap.generatedAt) {
      r(`${ansi.cyan}generated at${ansi.reset} ${snap.generatedAt.replace("T", " ").slice(0, 19)} UTC`);
    }
    const meta: string[] = [];
    if (snap.stopReason) meta.push(`stop: ${snap.stopReason}`);
    if (snap.branch)     meta.push(`branch: ${snap.branch}`);
    if (snap.tokensIn)   meta.push(`tokens in: ${fmtNum(snap.tokensIn)}`);
    if (snap.cacheRead)  meta.push(`cache read: ${fmtNum(snap.cacheRead)}`);
    if (meta.length > 0) r(`${ansi.gray}${meta.join("   ")}${ansi.reset}`);
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  const clock = data.refreshedAt.toISOString().slice(11, 19) + " UTC";
  rows.push(boxBottom(width, `${clock} · q quit · r refresh`));

  return rows.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runDashboard(opts: DashboardOptions): Promise<void> {
  const width = () => Math.max(60, Math.min(process.stdout.columns || 100, 120));

  let stopped = false;

  const draw = async () => {
    if (stopped) return;
    try {
      const data = await gatherData(opts);
      process.stdout.write(ansi.clearScreen + render(data, width()));
    } catch (err) {
      process.stdout.write(ansi.clearScreen + `continuum ui error: ${(err as Error).message}\n`);
    }
  };

  process.stdout.write(ansi.hideCursor);
  await draw();
  const timer = setInterval(draw, REFRESH_MS);

  const cleanup = () => {
    stopped = true;
    clearInterval(timer);
    process.stdout.write(ansi.showCursor + "\n");
    process.exit(0);
  };

  // Key input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (key: string) => {
    if (key === "q" || key === "") {
      cleanup();
    } else if (key === "r") {
      await draw();
    }
  });

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  // Restore cursor if the process exits for any other reason.
  process.on("exit", () => process.stdout.write(ansi.showCursor));
}
