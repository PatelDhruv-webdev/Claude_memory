import { describe, it, expect } from "vitest";
import { toEvents } from "../src/sources/markdown.js";

describe("markdown transcript parser", () => {
  it("parses # User / # Assistant headings", () => {
    const raw = [
      "# User",
      "Hello there",
      "",
      "# Assistant",
      "Hi back",
    ].join("\n");
    const events = toEvents(raw);
    expect(events.length).toBe(2);
    expect(events[0]!.message!.role).toBe("user");
    expect(events[0]!.message!.content).toBe("Hello there");
    expect(events[1]!.message!.role).toBe("assistant");
  });

  it("parses **User:** / **Assistant:** style", () => {
    const raw = [
      "**User:**",
      "do thing",
      "",
      "**Assistant:**",
      "did thing",
    ].join("\n");
    const events = toEvents(raw);
    expect(events.length).toBe(2);
    expect(events[0]!.message!.content).toBe("do thing");
  });

  it("treats preamble before first role marker as a user goal", () => {
    const raw = [
      "Some context paragraph",
      "still preamble",
      "",
      "# Assistant",
      "response",
    ].join("\n");
    const events = toEvents(raw);
    expect(events[0]!.message!.role).toBe("user");
    expect(events[0]!.message!.content).toContain("context paragraph");
  });

  it("collapses # System into the user stream", () => {
    const raw = ["# System", "be helpful", "", "# User", "go"].join("\n");
    const events = toEvents(raw);
    // System mapped to user-type event (for goal extraction)
    expect(events.some((e) => e.message!.content!.toString().includes("be helpful"))).toBe(true);
  });

  it("handles ## sub-heading variant", () => {
    const raw = ["## User", "x", "", "## Assistant", "y"].join("\n");
    const events = toEvents(raw);
    expect(events.length).toBe(2);
  });

  it("ignores trailing whitespace and empty turns", () => {
    const raw = ["# User", "", "", "# Assistant", "real reply"].join("\n");
    const events = toEvents(raw);
    expect(events.length).toBe(1); // empty user turn dropped
    expect(events[0]!.message!.role).toBe("assistant");
  });
});
