import { describe, it, expect } from "vitest";
import {
  detectSessionEnd,
  hasRateLimitSignal,
  isTerminalStopReason,
} from "../src/daemon/session-end.js";

describe("isTerminalStopReason", () => {
  it("treats refusal/max_tokens/pause_turn as terminal", () => {
    expect(isTerminalStopReason("refusal")).toBe(true);
    expect(isTerminalStopReason("max_tokens")).toBe(true);
    expect(isTerminalStopReason("pause_turn")).toBe(true);
  });

  it("treats normal stop reasons as non-terminal", () => {
    expect(isTerminalStopReason("end_turn")).toBe(false);
    expect(isTerminalStopReason("tool_use")).toBe(false);
    expect(isTerminalStopReason("stop_sequence")).toBe(false);
  });

  it("handles null/undefined safely", () => {
    expect(isTerminalStopReason(null)).toBe(false);
    expect(isTerminalStopReason(undefined)).toBe(false);
    expect(isTerminalStopReason("")).toBe(false);
  });
});

describe("hasRateLimitSignal", () => {
  it("detects rate limit phrasing case-insensitively", () => {
    expect(hasRateLimitSignal("Error: rate limit exceeded")).toBe(true);
    expect(hasRateLimitSignal("RATE LIMIT")).toBe(true);
    expect(hasRateLimitSignal("you are being rate limited; retry later")).toBe(true);
    expect(hasRateLimitSignal("rate_limit_error")).toBe(true);
    expect(hasRateLimitSignal("usage limit reached")).toBe(true);
    expect(hasRateLimitSignal("quota exceeded for org")).toBe(true);
  });

  it("does not false-positive on unrelated text", () => {
    expect(hasRateLimitSignal("everything is fine")).toBe(false);
    expect(hasRateLimitSignal("the rate of progress is good")).toBe(false);
  });
});

describe("detectSessionEnd", () => {
  it("returns ended:false on a clean tail with end_turn", () => {
    const tail = '{"stop_reason":"end_turn"}';
    expect(detectSessionEnd(tail).ended).toBe(false);
  });

  it("returns ended:true with the terminal reason", () => {
    const tail = '{"stop_reason":"refusal"}';
    const r = detectSessionEnd(tail);
    expect(r.ended).toBe(true);
    expect(r.reason).toBe("refusal");
  });

  it("uses the LAST stop_reason in the tail", () => {
    const tail = '{"stop_reason":"tool_use"}\n{"stop_reason":"end_turn"}\n{"stop_reason":"max_tokens"}';
    const r = detectSessionEnd(tail);
    expect(r.ended).toBe(true);
    expect(r.reason).toBe("max_tokens");
  });

  it("flags rate limit even when stop_reason is benign", () => {
    const tail = '{"stop_reason":"end_turn"}\n{"is_error":true,"content":"rate limit exceeded"}';
    const r = detectSessionEnd(tail);
    expect(r.ended).toBe(true);
    expect(r.reason).toBe("rate_limit");
  });

  it("rate limit takes precedence over terminal stop_reason", () => {
    const tail = 'rate limit error\n{"stop_reason":"refusal"}';
    const r = detectSessionEnd(tail);
    expect(r.ended).toBe(true);
    expect(r.reason).toBe("rate_limit");
  });

  it("returns ended:false on an empty tail", () => {
    expect(detectSessionEnd("").ended).toBe(false);
  });
});
