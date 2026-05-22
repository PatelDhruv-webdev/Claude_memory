import { describe, it, expect, vi } from "vitest";
import { digest } from "../src/llm/digest.js";
import type { LlmClient } from "../src/llm/client.js";
import type { SessionState } from "../src/snapshot/types.js";
import { defaultConfig } from "../src/config/io.js";

function mockState(): SessionState {
  return {
    goal: "fix bug",
    filesTouched: new Map([["/x.ts", { path: "/x.ts", reads: 0, edits: 1, writes: 0 }]]),
    commands: [],
    errors: [],
    tokenUsage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    stopReason: "end_turn",
    lastTurns: [{ role: "user", text: "fix bug" }],
  };
}

describe("digest JSON-repair retry", () => {
  it("re-prompts once if the first response is unparseable, succeeds on retry", async () => {
    let call = 0;
    const calls: string[] = [];
    const client: LlmClient = {
      name: "fake",
      chat: vi.fn(async (req) => {
        call++;
        calls.push(req.user);
        if (call === 1) return { content: "Sure! Here you go.", raw: null };
        return {
          content: '{"what_we_did":"- did","decisions_made":"","rejected_approaches":""}',
          raw: null,
        };
      }),
    };
    const r = await digest(mockState(), defaultConfig(), client);
    expect(r.narrative!.what_we_did).toBe("- did");
    expect(call).toBe(2);
    expect(calls[1]).toContain("Your previous response was not valid JSON");
  });

  it("gives up after one repair retry if still unparseable", async () => {
    let call = 0;
    const client: LlmClient = {
      name: "fake",
      chat: vi.fn(async () => {
        call++;
        return { content: "still no JSON", raw: null };
      }),
    };
    const r = await digest(mockState(), defaultConfig(), client);
    expect(r.narrative).toBeNull();
    expect(r.error).toContain("after repair retry");
    expect(call).toBe(2);
  });

  it("does NOT do a repair retry when the first response parses cleanly", async () => {
    let call = 0;
    const client: LlmClient = {
      name: "fake",
      chat: vi.fn(async () => {
        call++;
        return {
          content: '{"what_we_did":"ok","decisions_made":"","rejected_approaches":""}',
          raw: null,
        };
      }),
    };
    const r = await digest(mockState(), defaultConfig(), client);
    expect(r.narrative!.what_we_did).toBe("ok");
    expect(call).toBe(1);
  });
});
