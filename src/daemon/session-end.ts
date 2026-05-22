/**
 * Detects "terminal" stop reasons that indicate the user's session is over
 * and a snapshot should fire immediately, not after the idle timeout.
 *
 * These are the stop reasons that mean "the model isn't going to continue
 * on its own — the user needs to do something":
 *   - "refusal"      : model refused, conversation likely abandoned
 *   - "max_tokens"   : hit the per-response cap; user has to react
 *   - "pause_turn"   : Claude Code's "paused for input" signal
 *
 * Not terminal:
 *   - "end_turn"     : routine; the user may reply, idle timer handles it
 *   - "tool_use"     : middle of a tool round-trip
 *   - "stop_sequence": treated like end_turn
 *
 * Rate-limit detection: there isn't a standard stop_reason for this; we
 * scan the last tool_result tail for known rate-limit substrings.
 */
const TERMINAL_STOP_REASONS = new Set(["refusal", "max_tokens", "pause_turn"]);

const RATE_LIMIT_PATTERNS = [
  "rate limit",
  "rate_limit",
  "quota exceeded",
  "usage limit",
  "you are being rate limited",
];

export function isTerminalStopReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return TERMINAL_STOP_REASONS.has(reason);
}

export function hasRateLimitSignal(tail: string): boolean {
  const lower = tail.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Combined check used by the daemon: given the latest tail of the JSONL,
 * decide if we just observed a terminal condition.
 */
export function detectSessionEnd(tail: string): { ended: boolean; reason?: string } {
  if (hasRateLimitSignal(tail)) return { ended: true, reason: "rate_limit" };

  // Cheap stop_reason scan: look for the last `"stop_reason":"<value>"` token.
  const matches = [...tail.matchAll(/"stop_reason"\s*:\s*"([^"]+)"/g)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1]![1]!;
    if (isTerminalStopReason(last)) return { ended: true, reason: last };
  }
  return { ended: false };
}
