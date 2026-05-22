import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseSessionFile } from "../src/snapshot/parse.js";
import { extractState } from "../src/snapshot/extract.js";

const FIXTURES = join(__dirname, "fixtures");

describe("extractState", () => {
  it("extracts goal, files, commands, tokens, stop reason from a clean session", async () => {
    const state = await extractState(
      parseSessionFile(join(FIXTURES, "session-clean-end.jsonl")),
      { lastTurns: 8 },
    );

    expect(state.goal).toBe("Add a hello function to src/hello.ts");
    expect(state.stopReason).toBe("end_turn");

    const hello = state.filesTouched.get("/proj/src/hello.ts");
    expect(hello).toBeDefined();
    expect(hello!.writes).toBe(1);

    expect(state.commands.length).toBe(1);
    expect(state.commands[0]!.command).toBe("ls src");

    expect(state.tokenUsage.input).toBe(120 + 150 + 170);
    expect(state.tokenUsage.output).toBe(40 + 35 + 10);

    expect(state.errors.length).toBe(0);
    expect(state.lastTurns.length).toBeGreaterThan(0);
    expect(state.lastTurns[0]!.role).toBe("user");
  });

  it("captures errors and counts file reads", async () => {
    const state = await extractState(
      parseSessionFile(join(FIXTURES, "session-with-errors.jsonl")),
      { lastTurns: 8 },
    );

    expect(state.goal).toBe("Run the tests");
    expect(state.errors.length).toBe(1);
    expect(state.errors[0]!.message).toContain("rate limit");
    expect(state.errors[0]!.toolName).toBe("Bash");

    const pkg = state.filesTouched.get("/proj/package.json");
    expect(pkg).toBeDefined();
    expect(pkg!.reads).toBe(1);

    expect(state.commands.length).toBe(1);
    expect(state.commands[0]!.command).toBe("npm test");
  });

  it("respects lastTurns limit", async () => {
    const state = await extractState(
      parseSessionFile(join(FIXTURES, "session-clean-end.jsonl")),
      { lastTurns: 2 },
    );
    expect(state.lastTurns.length).toBe(2);
  });
});
