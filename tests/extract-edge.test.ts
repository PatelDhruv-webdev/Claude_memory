import { describe, it, expect } from "vitest";
import { extractState } from "../src/snapshot/extract.js";
import type { RawEvent } from "../src/snapshot/types.js";

async function* gen(events: RawEvent[]): AsyncIterable<RawEvent> {
  for (const e of events) yield e;
}

describe("extractState edge cases", () => {
  it("handles an empty event stream", async () => {
    const s = await extractState(gen([]), { lastTurns: 8 });
    expect(s.goal).toBe("");
    expect(s.filesTouched.size).toBe(0);
    expect(s.commands.length).toBe(0);
    expect(s.errors.length).toBe(0);
    expect(s.stopReason).toBeNull();
    expect(s.tokenUsage).toEqual({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
  });

  it("accepts user content as a string OR as a content-block array", async () => {
    const events: RawEvent[] = [
      {
        type: "user",
        timestamp: "2026-05-22T10:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "goal-block" }] },
      },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.goal).toBe("goal-block");
  });

  it("sums usage fields and tolerates missing ones", async () => {
    const events: RawEvent[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: "x",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: "y",
          usage: { input_tokens: 5, cache_read_input_tokens: 1000 },
        },
      },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.tokenUsage.input).toBe(105);
    expect(s.tokenUsage.output).toBe(50);
    expect(s.tokenUsage.cacheRead).toBe(1000);
  });

  it("tool_result with no matching tool_use is recorded as an error (if flagged)", async () => {
    const events: RawEvent[] = [
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "orphan", is_error: true, content: "boom" },
          ],
        },
      },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.errors.length).toBe(1);
    expect(s.errors[0]!.message).toContain("boom");
  });

  it("tool_use with no matching tool_result still records the file/command (best-effort)", async () => {
    const events: RawEvent[] = [
      {
        type: "user",
        message: { role: "user", content: "run something" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/x/y.ts" } },
          ],
        },
      },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.filesTouched.get("/x/y.ts")?.edits).toBe(1);
    expect(s.commands.length).toBe(0); // No tool_result for any Bash
  });

  it("counts MultiEdit and NotebookEdit as edits", async () => {
    const events: RawEvent[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "a", name: "MultiEdit", input: { file_path: "/a.ts" } },
            { type: "tool_use", id: "b", name: "NotebookEdit", input: { notebook_path: "/n.ipynb" } },
          ],
        },
      },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.filesTouched.get("/a.ts")?.edits).toBe(1);
    expect(s.filesTouched.get("/n.ipynb")?.edits).toBe(1);
  });

  it("handles unicode + special chars in commands and paths", async () => {
    const events: RawEvent[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "b1",
              name: "Bash",
              input: { command: "echo 'héllo 🦊'\nls" },
            },
            { type: "tool_use", id: "e1", name: "Edit", input: { file_path: "/проj/файл.ts" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "b1", content: "ok" }],
        },
      },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.commands[0]!.command).toContain("héllo");
    expect(s.commands[0]!.command).toContain("🦊");
    expect(s.filesTouched.get("/проj/файл.ts")?.edits).toBe(1);
  });

  it("truncates very long tool_result output", async () => {
    const long = "x".repeat(10_000);
    const events: RawEvent[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "yes" } }],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "b1", content: long }],
        },
      },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.commands[0]!.output!.length).toBeLessThan(long.length);
  });

  it("stopReason takes the LAST assistant value (not the first)", async () => {
    const events: RawEvent[] = [
      {
        type: "assistant",
        message: { role: "assistant", content: "a", stop_reason: "tool_use" },
      },
      {
        type: "assistant",
        message: { role: "assistant", content: "b", stop_reason: "end_turn" },
      },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.stopReason).toBe("end_turn");
  });

  it("preserves first user message as goal even after many subsequent ones", async () => {
    const events: RawEvent[] = [
      { type: "user", message: { role: "user", content: "first goal" } },
      { type: "user", message: { role: "user", content: "later message" } },
      { type: "user", message: { role: "user", content: "even later" } },
    ];
    const s = await extractState(gen(events), { lastTurns: 8 });
    expect(s.goal).toBe("first goal");
  });
});
