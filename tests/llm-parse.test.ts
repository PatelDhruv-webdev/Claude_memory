import { describe, it, expect } from "vitest";
import { parseNarrative } from "../src/llm/parse.js";

describe("parseNarrative", () => {
  it("parses a clean JSON object", () => {
    const raw = `{"what_we_did":"- a","decisions_made":"","rejected_approaches":""}`;
    const n = parseNarrative(raw);
    expect(n).not.toBeNull();
    expect(n!.what_we_did).toBe("- a");
  });

  it("strips ```json code fences", () => {
    const raw = "```json\n{\"what_we_did\":\"- x\",\"decisions_made\":\"\",\"rejected_approaches\":\"\"}\n```";
    const n = parseNarrative(raw);
    expect(n!.what_we_did).toBe("- x");
  });

  it("strips plain ``` code fences", () => {
    const raw = "```\n{\"what_we_did\":\"y\",\"decisions_made\":\"\",\"rejected_approaches\":\"\"}\n```";
    const n = parseNarrative(raw);
    expect(n!.what_we_did).toBe("y");
  });

  it("ignores text before the JSON block", () => {
    const raw = "Sure, here is the JSON:\n\n{\"what_we_did\":\"z\",\"decisions_made\":\"\",\"rejected_approaches\":\"\"}";
    const n = parseNarrative(raw);
    expect(n!.what_we_did).toBe("z");
  });

  it("handles nested braces inside strings", () => {
    const raw = `{"what_we_did":"used { and } in code","decisions_made":"","rejected_approaches":""}`;
    const n = parseNarrative(raw);
    expect(n!.what_we_did).toBe("used { and } in code");
  });

  it("returns null when no JSON object is present", () => {
    expect(parseNarrative("totally unstructured text")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseNarrative('{"what_we_did": "x", oops}')).toBeNull();
  });

  it("treats array values as joined bullets", () => {
    const raw = `{"what_we_did":["a","b","- c"],"decisions_made":"","rejected_approaches":""}`;
    const n = parseNarrative(raw);
    expect(n!.what_we_did).toBe("- a\n- b\n- c");
  });

  it("fills missing keys with empty strings instead of failing", () => {
    const raw = `{"what_we_did":"only this one"}`;
    const n = parseNarrative(raw);
    expect(n!.what_we_did).toBe("only this one");
    expect(n!.decisions_made).toBe("");
    expect(n!.rejected_approaches).toBe("");
  });

  it("ignores extra unexpected keys", () => {
    const raw = `{"what_we_did":"ok","decisions_made":"","rejected_approaches":"","extra":"ignored"}`;
    const n = parseNarrative(raw);
    expect(n!.what_we_did).toBe("ok");
  });

  it("returns null for top-level arrays", () => {
    expect(parseNarrative('[1,2,3]')).toBeNull();
  });
});
