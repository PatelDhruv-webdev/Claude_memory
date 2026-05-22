import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/io.js";
import {
  claudeProjectsDir,
  configPath,
  continuumDir,
  encodeProjectPath,
  logPath,
  pidPath,
} from "../util/paths.js";
import { discoverSession } from "../snapshot/discover.js";
import { isOllamaInstalled, isOllamaRunning } from "../providers/ollama.js";
import { readLivePid } from "../daemon/pidfile.js";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface Check {
  name: string;
  status: CheckStatus;
  message: string;
  hint?: string;
}

export interface DoctorOptions {
  cwd: string;
}

export async function runDoctor(opts: DoctorOptions): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. ~/.continuum exists or can be created
  checks.push(await checkContinuumDir());

  // 2. config file
  const config = await loadConfig().catch(() => null);
  checks.push(checkConfig(config));

  // 3. Claude projects dir + session for cwd
  checks.push(await checkClaudeProjects());
  checks.push(await checkSession(opts.cwd));

  // 4. provider reachability (depends on mode)
  if (config?.mode === "local_llm") {
    checks.push(...(await checkOllama()));
  } else if (config?.mode === "external_api") {
    checks.push(checkApiKeyEnv(config.external_api.api_key_env));
  } else if (config?.mode === "factual_only") {
    checks.push({
      name: "LLM provider",
      status: "skip",
      message: "mode=factual_only; no provider configured",
    });
  } else {
    checks.push({
      name: "LLM provider",
      status: "warn",
      message: "no config; provider checks skipped",
      hint: "Run `continuum reinstall` to set one up.",
    });
  }

  // 5. daemon status
  checks.push(await checkDaemon());

  // 6. last snapshot freshness (HANDOFF.md in cwd)
  checks.push(await checkLastSnapshot(opts.cwd, config?.snapshot.handoff_filename ?? "HANDOFF.md"));

  // 7. log file
  checks.push(await checkLogFile());

  return checks;
}

async function checkContinuumDir(): Promise<Check> {
  const dir = continuumDir();
  if (existsSync(dir)) {
    return { name: "~/.continuum directory", status: "ok", message: dir };
  }
  return {
    name: "~/.continuum directory",
    status: "warn",
    message: `not yet created (${dir})`,
    hint: "First run of `continuum reinstall` will create it.",
  };
}

function checkConfig(config: unknown): Check {
  const path = configPath();
  if (!existsSync(path)) {
    return {
      name: "config",
      status: "warn",
      message: `no config at ${path}`,
      hint: "Run `continuum reinstall`.",
    };
  }
  if (!config) {
    return {
      name: "config",
      status: "fail",
      message: `config exists but failed to load`,
      hint: "Check for a .broken-* sibling file; run `continuum reinstall` to regenerate.",
    };
  }
  return { name: "config", status: "ok", message: path };
}

async function checkClaudeProjects(): Promise<Check> {
  const dir = claudeProjectsDir();
  if (!existsSync(dir)) {
    return {
      name: "Claude Code projects dir",
      status: "fail",
      message: `${dir} not found`,
      hint: "Use Claude Code at least once so the directory is created.",
    };
  }
  return { name: "Claude Code projects dir", status: "ok", message: dir };
}

async function checkSession(cwd: string): Promise<Check> {
  const path = await discoverSession(cwd);
  if (!path) {
    const expected = join(claudeProjectsDir(), encodeProjectPath(cwd));
    return {
      name: "session for current dir",
      status: "warn",
      message: `no .jsonl found for ${cwd}`,
      hint: `Expected location: ${expected}. Use Claude Code in this dir first.`,
    };
  }
  const s = await stat(path);
  const ageMin = Math.round((Date.now() - s.mtimeMs) / 60_000);
  return {
    name: "session for current dir",
    status: "ok",
    message: `${path} (${ageMin} min old, ${(s.size / 1024).toFixed(1)} KB)`,
  };
}

async function checkOllama(): Promise<Check[]> {
  const checks: Check[] = [];
  const installed = await isOllamaInstalled();
  if (!installed) {
    checks.push({
      name: "ollama installed",
      status: "fail",
      message: "ollama binary not found on PATH",
      hint: "Run `continuum reinstall` (option 1) to install it.",
    });
    return checks;
  }
  checks.push({ name: "ollama installed", status: "ok", message: "found on PATH" });
  const running = await isOllamaRunning();
  if (!running) {
    checks.push({
      name: "ollama running",
      status: "fail",
      message: "ollama API not reachable at localhost:11434",
      hint: "Start with `ollama serve` (or your service manager).",
    });
  } else {
    checks.push({ name: "ollama running", status: "ok", message: "reachable" });
  }
  return checks;
}

function checkApiKeyEnv(envVar: string): Check {
  const val = process.env[envVar];
  if (!val) {
    return {
      name: "API key env",
      status: "fail",
      message: `$${envVar} is not set`,
      hint: `Export ${envVar}=... in your shell rc.`,
    };
  }
  return { name: "API key env", status: "ok", message: `$${envVar} is set (${val.length} chars)` };
}

async function checkDaemon(): Promise<Check> {
  const rec = await readLivePid(pidPath());
  if (!rec) return { name: "daemon", status: "ok", message: "not running" };
  return {
    name: "daemon",
    status: "ok",
    message: `running (PID ${rec.pid}, project ${rec.projectRoot}, since ${rec.startedAt})`,
  };
}

async function checkLastSnapshot(cwd: string, filename: string): Promise<Check> {
  const path = join(cwd, filename);
  if (!existsSync(path)) {
    return {
      name: "last snapshot",
      status: "warn",
      message: `no ${filename} in ${cwd}`,
      hint: "Run `continuum snapshot` to produce one.",
    };
  }
  const s = await stat(path);
  const ageMin = Math.round((Date.now() - s.mtimeMs) / 60_000);
  return {
    name: "last snapshot",
    status: "ok",
    message: `${path} (${ageMin} min old, ${(s.size / 1024).toFixed(1)} KB)`,
  };
}

async function checkLogFile(): Promise<Check> {
  const path = logPath();
  if (!existsSync(path)) return { name: "daemon log", status: "ok", message: "no log yet" };
  const s = await stat(path);
  const sizeMb = s.size / (1024 * 1024);
  if (sizeMb > 10) {
    return {
      name: "daemon log",
      status: "warn",
      message: `${path} is ${sizeMb.toFixed(1)} MB`,
      hint: "Log rotation kicks in at 10 MB on the next daemon restart.",
    };
  }
  return { name: "daemon log", status: "ok", message: `${path} (${(s.size / 1024).toFixed(1)} KB)` };
}

export function formatChecks(checks: Check[]): string {
  const symbol = (s: CheckStatus) =>
    s === "ok" ? "✓" : s === "warn" ? "!" : s === "fail" ? "✗" : "·";
  const lines = checks.map((c) => {
    const main = `${symbol(c.status)} ${c.name}: ${c.message}`;
    return c.hint ? `${main}\n    hint: ${c.hint}` : main;
  });
  return lines.join("\n");
}

export function worstStatus(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}
