import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../util/atomic.js";

export interface InitOptions {
  cwd: string;
  /** Also write a project-local .continuum/config.yml stub. */
  withProjectConfig?: boolean;
  /** Override default HANDOFF filenames when writing .gitignore. */
  handoffFilename?: string;
  diffFilename?: string;
}

export interface InitResult {
  /** Steps performed; useful for the CLI to print a summary. */
  steps: Array<{ name: string; status: "done" | "skipped"; detail?: string }>;
}

const GITIGNORE_BLOCK_HEADER = "# Added by continuum";

/**
 * Idempotent project setup. Run repeatedly; only does work that hasn't
 * been done yet.
 */
export async function runInit(opts: InitOptions): Promise<InitResult> {
  const steps: InitResult["steps"] = [];
  const handoff = opts.handoffFilename ?? "HANDOFF.md";
  const diff = opts.diffFilename ?? "HANDOFF.diff";

  // 1. .gitignore entries
  const gitignorePath = join(opts.cwd, ".gitignore");
  const existing = existsSync(gitignorePath)
    ? await readFile(gitignorePath, "utf8")
    : "";

  const wanted = [handoff, diff];
  const missing = wanted.filter((entry) => !hasIgnoreEntry(existing, entry));

  if (missing.length === 0) {
    steps.push({
      name: ".gitignore",
      status: "skipped",
      detail: `${handoff} and ${diff} already ignored`,
    });
  } else {
    const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    const block = `${sep}${existing.length > 0 ? "\n" : ""}${GITIGNORE_BLOCK_HEADER}\n${missing.join("\n")}\n`;
    if (existing.length > 0) {
      await appendFile(gitignorePath, block);
    } else {
      await writeFile(gitignorePath, block);
    }
    steps.push({
      name: ".gitignore",
      status: "done",
      detail: `added ${missing.join(", ")}`,
    });
  }

  // 2. Project-local config (optional)
  if (opts.withProjectConfig) {
    const dir = join(opts.cwd, ".continuum");
    const cfgPath = join(dir, "config.yml");
    if (existsSync(cfgPath)) {
      steps.push({ name: ".continuum/config.yml", status: "skipped", detail: "already exists" });
    } else {
      await mkdir(dir, { recursive: true });
      await writeFileAtomic(
        cfgPath,
        [
          "# Project-local continuum overrides. Merged on top of ~/.continuum/config.yml.",
          "# Uncomment and edit any field you want to override for this project only.",
          "",
          "# triggers:",
          "#   idle_minutes: 3",
          "",
          "# snapshot:",
          "#   last_turns: 12",
          "#   keep_history: 5",
          "",
          "# redact:",
          "#   extra_patterns:",
          "#     - { name: 'internal_token', pattern: 'INT-[A-Z0-9]{12}' }",
          "",
        ].join("\n"),
      );
      steps.push({ name: ".continuum/config.yml", status: "done", detail: `wrote ${cfgPath}` });
    }
  }

  return { steps };
}

function hasIgnoreEntry(content: string, entry: string): boolean {
  const lines = content.split(/\r?\n/);
  return lines.some((l) => l.trim() === entry || l.trim() === `/${entry}`);
}
