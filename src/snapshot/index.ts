import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCodeSource } from "../sources/claude-code.js";
import type { Config } from "../config/schema.js";
import { extractState } from "./extract.js";
import { getGitInfo } from "./git.js";
import { render } from "./render.js";

export interface SnapshotOptions {
  cwd: string;
  config: Config;
  outDir?: string; // defaults to cwd
}

export interface SnapshotResult {
  handoffPath: string;
  diffPath: string;
  sourceFile: string;
}

export async function snapshot(
  opts: SnapshotOptions,
): Promise<SnapshotResult> {
  const source = claudeCodeSource;

  const sessionFile = await source.discover(opts.cwd);
  if (!sessionFile) {
    throw new Error(
      `No Claude Code session found for ${opts.cwd}. ` +
        "Make sure you've used Claude Code in this directory at least once.",
    );
  }

  const state = await extractState(source.parse(sessionFile), {
    lastTurns: opts.config.snapshot.last_turns,
  });

  const git = await getGitInfo(opts.cwd);

  const markdown = render(state, git, null, {
    generatedAt: new Date().toISOString(),
    projectPath: opts.cwd,
    sourceFile: sessionFile,
    lastTurnsCount: opts.config.snapshot.last_turns,
  });

  const outDir = opts.outDir ?? opts.cwd;
  const handoffPath = join(outDir, opts.config.snapshot.handoff_filename);
  const diffPath = join(outDir, opts.config.snapshot.diff_filename);

  await writeFile(handoffPath, markdown, "utf8");
  await writeFile(diffPath, git.diff, "utf8");

  return { handoffPath, diffPath, sourceFile: sessionFile };
}
