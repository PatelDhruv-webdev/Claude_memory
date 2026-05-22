import { join } from "node:path";
import { claudeCodeSource } from "../sources/claude-code.js";
import type { Config } from "../config/schema.js";
import { extractState } from "./extract.js";
import { getGitInfo } from "./git.js";
import { render } from "./render.js";
import { rotateHandoff } from "./history.js";
import { writeFileAtomic } from "../util/atomic.js";
import { NoSessionError } from "../util/errors.js";
import { redactSessionState } from "../redact/apply.js";
import { redactText } from "../redact/rules.js";
import { compileExtraRules } from "../redact/config.js";
import type { NarrativeSections } from "./types.js";

const MAX_DIFF_BYTES = 50 * 1024 * 1024;

export interface SnapshotOptions {
  cwd: string;
  config: Config;
  outDir?: string;
  narrative?: NarrativeSections | null;
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
  if (!sessionFile) throw new NoSessionError(opts.cwd);

  const rawState = await extractState(source.parse(sessionFile), {
    lastTurns: opts.config.snapshot.last_turns,
  });

  const extraRules = compileExtraRules(opts.config.redact.extra_patterns);
  const state = opts.config.redact.enabled
    ? redactSessionState(rawState, { extraRules }).state
    : rawState;

  const git = await getGitInfo(opts.cwd);

  const markdown = render(state, git, opts.narrative ?? null, {
    generatedAt: new Date().toISOString(),
    projectPath: opts.cwd,
    sourceFile: sessionFile,
    lastTurnsCount: opts.config.snapshot.last_turns,
  });

  const outDir = opts.outDir ?? opts.cwd;
  const handoffPath = join(outDir, opts.config.snapshot.handoff_filename);
  const diffPath = join(outDir, opts.config.snapshot.diff_filename);

  await rotateHandoff(opts.cwd, handoffPath, opts.config.snapshot.keep_history);

  const diffBody =
    Buffer.byteLength(git.diff, "utf8") > MAX_DIFF_BYTES
      ? git.diff.slice(0, MAX_DIFF_BYTES) +
        "\n... (truncated — diff exceeded 50 MB)\n"
      : git.diff;
  const finalDiff = opts.config.redact.enabled
    ? redactText(diffBody, { extraRules })
    : diffBody;

  await writeFileAtomic(handoffPath, markdown);
  await writeFileAtomic(diffPath, finalDiff);

  return { handoffPath, diffPath, sourceFile: sessionFile };
}
