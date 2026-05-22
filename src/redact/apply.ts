import type { SessionState } from "../snapshot/types.js";
import { redact, type RedactOptions, type RedactionStats } from "./rules.js";

/**
 * Redact secrets from a SessionState in place (mutates a deep copy and
 * returns it). Applied to goal, commands, errors, turn text, and tool
 * outputs — anywhere session content might contain a leaked secret.
 *
 * Returns the redacted state plus aggregate stats so callers can log
 * "n secrets redacted before LLM call" or similar.
 */
export function redactSessionState(
  state: SessionState,
  opts: RedactOptions = {},
): { state: SessionState; stats: RedactionStats } {
  const counts: Record<string, number> = {};
  let bytesReplaced = 0;

  const apply = (s: string): string => {
    const r = redact(s, opts);
    for (const [k, v] of Object.entries(r.stats.counts)) {
      counts[k] = (counts[k] ?? 0) + v;
    }
    bytesReplaced += r.stats.bytesReplaced;
    return r.text;
  };

  const next: SessionState = {
    goal: apply(state.goal),
    filesTouched: state.filesTouched, // file paths rarely contain secrets
    commands: state.commands.map((c) => ({
      ...c,
      command: apply(c.command),
      output: c.output ? apply(c.output) : c.output,
    })),
    errors: state.errors.map((e) => ({ ...e, message: apply(e.message) })),
    tokenUsage: state.tokenUsage,
    stopReason: state.stopReason,
    lastTurns: state.lastTurns.map((t) => ({ ...t, text: apply(t.text) })),
    sessionId: state.sessionId,
    firstTimestamp: state.firstTimestamp,
    lastTimestamp: state.lastTimestamp,
  };

  return { state: next, stats: { counts, bytesReplaced } };
}
