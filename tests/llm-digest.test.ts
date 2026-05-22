import { describe, it, expect } from "vitest";
import { digest } from "../src/llm/digest.js";
import type { LlmClient } from "../src/llm/client.js";
import type { Config } from "../src/config/schema.js";
import type { SessionState } from "../src/snapshot/types.js";
import { defaultConfig } from "../src/config/io.js";

function mockState(): SessionState {
  return {
    goal: "fix bug",
    filesTouched: new Map([
      ["/x.ts", { path: "/x.ts", reads: 0, edits: 1, writes: 0 }],
    ]),
    commands: [{ command: "npm test", output: "ok" }],
    errors: [],
    tokenUsage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    stopReason: "end_turn",
    lastTurns: [{ role: "user", text: "fix bug" }],
  };
}

function configMode(mode: Config["mode"]): Config {
  const c = defaultConfig();
  c.mode = mode;
  return c;
}

function fakeClient(impl: LlmClient["chat"]): LlmClient {
  return { name: "fake", chat: impl };
}

describe("digest", () => {
  it("returns null narrative when mode is factual_only (no LLM call)", async () => {
    let called = false;
    const client = fakeClient(async () => {
      called = true;
      return { content: "{}", raw: null };
    });
    const r = await digest(mockState(), configMode("factual_only"), client);
    expect(r.narrative).toBeNull();
    expect(r.error).toContain("factual_only");
    expect(called).toBe(false);
  });

  it("returns null narrative for an empty session without calling the LLM", async () => {
    let called = false;
    const empty: SessionState = {
      goal: "",
      filesTouched: new Map(),
      commands: [],
      errors: [],
      tokenUsage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      stopReason: null,
      lastTurns: [],
    };
    const client = fakeClient(async () => {
      called = true;
      return { content: "", raw: null };
    });
    const r = await digest(empty, configMode("local_llm"), client);
    expect(r.narrative).toBeNull();
    expect(r.error).toContain("empty");
    expect(called).toBe(false);
  });

  it("happy path: parses model JSON into narrative", async () => {
    const client = fakeClient(async () => ({
      content: '{"what_we_did":"- did","decisions_made":"","rejected_approaches":""}',
      raw: null,
    }));
    const r = await digest(mockState(), configMode("local_llm"), client);
    expect(r.narrative!.what_we_did).toBe("- did");
  });

  it("returns null narrative on malformed model output", async () => {
    const client = fakeClient(async () => ({ content: "🤷 no JSON here", raw: null }));
    const r = await digest(mockState(), configMode("local_llm"), client);
    expect(r.narrative).toBeNull();
    expect(r.error).toContain("unparseable");
  });

  it("retries on transient errors then succeeds", async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls++;
      if (calls < 2) throw new Error("ECONNRESET");
      return {
        content: '{"what_we_did":"ok","decisions_made":"","rejected_approaches":""}',
        raw: null,
      };
    });
    const r = await digest(mockState(), configMode("local_llm"), client);
    expect(calls).toBe(2);
    expect(r.narrative!.what_we_did).toBe("ok");
  });

  it("does not retry on hard 401 auth errors", async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls++;
      throw new Error("HTTP 401 unauthorized");
    });
    const r = await digest(mockState(), configMode("local_llm"), client);
    expect(calls).toBe(1);
    expect(r.narrative).toBeNull();
    expect(r.error).toContain("401");
  });

  it("gives up after final retry and returns the last error", async () => {
    const client = fakeClient(async () => {
      throw new Error("network down");
    });
    const r = await digest(mockState(), configMode("local_llm"), client);
    expect(r.narrative).toBeNull();
    expect(r.error).toContain("network down");
  });
});
