import type {
  GitInfo,
  NarrativeSections,
  RenderMeta,
  SessionState,
} from "./types.js";

const NOT_GENERATED = "_(not generated — run with LLM enabled)_";

export function render(
  state: SessionState,
  git: GitInfo,
  narrative: NarrativeSections | null,
  meta: RenderMeta,
): string {
  const fm = renderFrontmatter(state, git, meta);
  const body = [
    "# Session Handoff",
    "",
    "## Goal",
    state.goal || "_(no user message found)_",
    "",
    "## What We Did",
    narrative?.what_we_did || NOT_GENERATED,
    "",
    "## Decisions Made",
    narrative?.decisions_made || NOT_GENERATED,
    "",
    "## Rejected Approaches",
    narrative?.rejected_approaches || NOT_GENERATED,
    "",
    "## Git State",
    renderGit(git),
    "",
    "## Files Touched",
    renderFiles(state),
    "",
    "## Commands Run",
    renderCommands(state),
    "",
    "## Errors",
    renderErrors(state),
    "",
    `## Last ${meta.lastTurnsCount} Turns`,
    renderTurns(state),
    "",
  ].join("\n");

  return `${fm}\n${body}`;
}

function renderFrontmatter(
  state: SessionState,
  git: GitInfo,
  meta: RenderMeta,
): string {
  const lines = [
    "---",
    `generated_at: ${meta.generatedAt}`,
    `project: ${meta.projectPath}`,
    `source_file: ${meta.sourceFile}`,
    `branch: ${git.branch}`,
    `stop_reason: ${state.stopReason ?? "null"}`,
    `tokens_in: ${state.tokenUsage.input}`,
    `tokens_out: ${state.tokenUsage.output}`,
    `cache_read: ${state.tokenUsage.cacheRead}`,
    `cache_create: ${state.tokenUsage.cacheCreate}`,
    "---",
  ];
  return lines.join("\n");
}

function renderGit(git: GitInfo): string {
  if (!git.isRepo) return "_(not a git repository)_";
  const status = git.status.trim() || "(clean)";
  return [
    `- Branch: \`${git.branch}\``,
    `- Last commit: ${git.lastCommit}`,
    "- Working tree:",
    "```",
    status,
    "```",
    "(Full diff: see `HANDOFF.diff`)",
  ].join("\n");
}

function renderFiles(state: SessionState): string {
  if (state.filesTouched.size === 0) return "_(none)_";

  const rows = Array.from(state.filesTouched.values())
    .map((ft) => ({ ...ft, total: ft.reads + ft.edits + ft.writes }))
    .sort((a, b) => b.total - a.total);

  const header = "| Path | Reads | Edits | Writes |";
  const sep = "|------|-------|-------|--------|";
  const body = rows
    .map((r) => `| \`${r.path}\` | ${r.reads} | ${r.edits} | ${r.writes} |`)
    .join("\n");
  return [header, sep, body].join("\n");
}

function renderCommands(state: SessionState): string {
  if (state.commands.length === 0) return "_(none)_";
  return state.commands
    .map((c) => {
      const desc = c.description ? ` _(${c.description})_` : "";
      return `- \`${c.command}\`${desc}`;
    })
    .join("\n");
}

function renderErrors(state: SessionState): string {
  if (state.errors.length === 0) return "_(none)_";
  return state.errors
    .map((e) => {
      const tool = e.toolName ? `**${e.toolName}**: ` : "";
      return `- ${tool}${oneLine(e.message)}`;
    })
    .join("\n");
}

function renderTurns(state: SessionState): string {
  if (state.lastTurns.length === 0) return "_(none)_";
  return state.lastTurns
    .map((t) => {
      const body = t.text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      return `**${t.role}:**\n${body}`;
    })
    .join("\n\n");
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
