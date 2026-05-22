import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseSessionFile } from "../src/snapshot/parse.js";
import { extractState } from "../src/snapshot/extract.js";
import { render } from "../src/snapshot/render.js";
import type { GitInfo, RenderMeta } from "../src/snapshot/types.js";

const FIXTURES = join(__dirname, "fixtures");

const fakeGit: GitInfo = {
  branch: "main",
  lastCommit: "abc1234 initial commit",
  status: " M src/hello.ts",
  diff: "diff --git a/src/hello.ts b/src/hello.ts\n",
  isRepo: true,
};

const fakeMeta: RenderMeta = {
  generatedAt: "2026-05-22T12:00:00Z",
  projectPath: "/proj",
  sourceFile: "/home/user/.claude/projects/-proj/abc.jsonl",
  lastTurnsCount: 8,
};

describe("render", () => {
  it("produces the expected HANDOFF.md structure with placeholders when no narrative", async () => {
    const state = await extractState(
      parseSessionFile(join(FIXTURES, "session-clean-end.jsonl")),
      { lastTurns: 8 },
    );
    const md = render(state, fakeGit, null, fakeMeta);

    expect(md).toMatch(/^---\n/);
    expect(md).toContain("generated_at: 2026-05-22T12:00:00Z");
    expect(md).toContain("branch: main");
    expect(md).toContain("# Session Handoff");
    expect(md).toContain("## Goal");
    expect(md).toContain("Add a hello function to src/hello.ts");
    expect(md).toContain("## What We Did");
    expect(md).toContain("_(not generated");
    expect(md).toContain("## Files Touched");
    expect(md).toContain("`/proj/src/hello.ts`");
    expect(md).toContain("## Commands Run");
    expect(md).toContain("`ls src`");
    expect(md).toContain("## Errors");
    expect(md).toContain("_(none)_");
    expect(md).toContain("## Last 8 Turns");
  });

  it("renders errors section when there are errors", async () => {
    const state = await extractState(
      parseSessionFile(join(FIXTURES, "session-with-errors.jsonl")),
      { lastTurns: 8 },
    );
    const md = render(state, fakeGit, null, fakeMeta);
    expect(md).toMatch(/## Errors\n- \*\*Bash\*\*:.*rate limit/);
  });

  it("renders narrative sections when provided", async () => {
    const state = await extractState(
      parseSessionFile(join(FIXTURES, "session-clean-end.jsonl")),
      { lastTurns: 8 },
    );
    const md = render(
      state,
      fakeGit,
      {
        what_we_did: "Created hello.ts.",
        decisions_made: "- Used a named export",
        rejected_approaches: "",
      },
      fakeMeta,
    );
    expect(md).toContain("Created hello.ts.");
    expect(md).toContain("- Used a named export");
    // Empty narrative field falls back to the placeholder
    expect(md).toMatch(/## Rejected Approaches\n_\(not generated/);
  });
});
