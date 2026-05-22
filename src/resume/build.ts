import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type ResumeTarget = "claude" | "codex" | "cursor" | "aider" | "generic";

export interface ResumeOptions {
  projectRoot: string;
  target: ResumeTarget;
  handoffFilename: string;
  diffFilename: string;
  includeDiff: boolean;
}

export interface ResumeResult {
  text: string;
  bytes: number;
  source: { handoff: string; diff: string | null };
}

/**
 * Build a primer message for the chosen agent by reading HANDOFF.md (and
 * optionally HANDOFF.diff) and wrapping it in agent-specific framing.
 *
 * The framing differs per target:
 *  - claude/generic: a plain "context handoff" preamble + the file
 *  - codex: prepend a system-style instruction
 *  - cursor: use Cursor's @-mention friendly markdown
 *  - aider: include both files as /add-style blocks
 */
export async function buildResume(opts: ResumeOptions): Promise<ResumeResult> {
  const handoffPath = join(opts.projectRoot, opts.handoffFilename);
  if (!existsSync(handoffPath)) {
    throw new Error(
      `No ${opts.handoffFilename} found in ${opts.projectRoot}. Run \`continuum snapshot\` first.`,
    );
  }
  const handoff = await readFile(handoffPath, "utf8");

  const diffPath = join(opts.projectRoot, opts.diffFilename);
  let diff: string | null = null;
  if (opts.includeDiff && existsSync(diffPath)) {
    diff = await readFile(diffPath, "utf8");
  }

  const text = format(opts.target, handoff, diff);
  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    source: { handoff: handoffPath, diff: diff !== null ? diffPath : null },
  };
}

function format(target: ResumeTarget, handoff: string, diff: string | null): string {
  switch (target) {
    case "claude":
    case "generic":
      return genericPrimer(handoff, diff);
    case "codex":
      return codexPrimer(handoff, diff);
    case "cursor":
      return cursorPrimer(handoff, diff);
    case "aider":
      return aiderPrimer(handoff, diff);
  }
}

const PREAMBLE = `I'm resuming a coding session that was previously in a different AI tool. Below is a structured handoff describing what was done, what was decided, and the current state of the working tree.

Please read the handoff, then proceed from where it left off. Do NOT re-do work that's already in the "What We Did" section.`;

function genericPrimer(handoff: string, diff: string | null): string {
  const parts = [PREAMBLE, "", "--- BEGIN HANDOFF ---", handoff.trimEnd(), "--- END HANDOFF ---"];
  if (diff && diff.trim()) {
    parts.push("", "--- BEGIN WORKING-TREE DIFF (git diff HEAD) ---", diff.trimEnd(), "--- END DIFF ---");
  }
  return parts.join("\n") + "\n";
}

function codexPrimer(handoff: string, diff: string | null): string {
  // Codex CLI takes prompts; lean on a system-style intro.
  const parts = [
    "[Resumed session]",
    PREAMBLE,
    "",
    "===== HANDOFF.md =====",
    handoff.trimEnd(),
    "===== END HANDOFF.md =====",
  ];
  if (diff && diff.trim()) {
    parts.push("", "===== HANDOFF.diff =====", diff.trimEnd(), "===== END HANDOFF.diff =====");
  }
  return parts.join("\n") + "\n";
}

function cursorPrimer(handoff: string, diff: string | null): string {
  // Cursor renders markdown well; use fenced sections so the file paths
  // stay clickable.
  const parts = [
    PREAMBLE,
    "",
    "## Handoff",
    "",
    "```markdown",
    handoff.trimEnd(),
    "```",
  ];
  if (diff && diff.trim()) {
    parts.push("", "## Working-tree diff", "", "```diff", diff.trimEnd(), "```");
  }
  return parts.join("\n") + "\n";
}

function aiderPrimer(handoff: string, diff: string | null): string {
  // Aider users typically /add HANDOFF.md directly; this primer is for
  // pasting the content when /add isn't available.
  const parts = [
    PREAMBLE,
    "",
    "# HANDOFF.md",
    handoff.trimEnd(),
  ];
  if (diff && diff.trim()) {
    parts.push("", "# HANDOFF.diff", "```diff", diff.trimEnd(), "```");
  }
  return parts.join("\n") + "\n";
}
