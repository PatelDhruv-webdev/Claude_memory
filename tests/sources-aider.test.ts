import { describe, it, expect } from "vitest";
import { toEvents } from "../src/sources/aider.js";

describe("aider transcript parser", () => {
  it("parses a basic user/assistant exchange", () => {
    const raw = [
      "# aider chat started at 2026-01-10 10:00:00",
      "",
      "> Add a hello function",
      "> in src/hello.ts",
      "",
      "I'll create that file for you.",
      "",
      "Added src/hello.ts to the chat.",
      "",
      "Tokens: 120 sent, 30 received",
    ].join("\n");
    const events = toEvents(raw);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.message!.role).toBe("user");
    expect(events[0]!.message!.content).toContain("Add a hello function");
    const assistant = events.find((e) => e.message!.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.message!.content).toContain("create that file");
  });

  it("strips aider token/cost footers and 'Added X to the chat' lines", () => {
    const raw = [
      "> hi",
      "",
      "Doing the thing.",
      "Added foo.ts to the chat.",
      "Tokens: 100 sent, 20 received",
      "Cost: $0.01",
    ].join("\n");
    const events = toEvents(raw);
    const assistant = events.find((e) => e.message!.role === "assistant")!;
    expect(assistant.message!.content).not.toContain("Tokens:");
    expect(assistant.message!.content).not.toContain("Cost:");
    expect(assistant.message!.content).not.toContain("Added foo.ts");
    expect(assistant.message!.content).toContain("Doing the thing");
  });

  it("captures the session timestamp from the header", () => {
    const raw = [
      "# aider chat started at 2026-03-15 14:22:00",
      "",
      "> hi",
      "",
      "hello",
    ].join("\n");
    const events = toEvents(raw);
    expect(events[0]!.timestamp).toBe("2026-03-15 14:22:00");
  });

  it("handles multiple user turns in one session", () => {
    const raw = [
      "> first",
      "",
      "reply 1",
      "",
      "> second",
      "",
      "reply 2",
    ].join("\n");
    const events = toEvents(raw);
    const users = events.filter((e) => e.message!.role === "user");
    expect(users.length).toBe(2);
    expect(users[0]!.message!.content).toContain("first");
    expect(users[1]!.message!.content).toContain("second");
  });

  it("returns no events for an empty transcript", () => {
    expect(toEvents("").length).toBe(0);
    expect(toEvents("\n\n\n").length).toBe(0);
  });
});
