import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResume } from "../src/resume/build.js";

describe("buildResume", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-resume-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function plant(handoff = "# Handoff\n\nbody", diff: string | null = null): Promise<void> {
    await writeFile(join(dir, "HANDOFF.md"), handoff);
    if (diff !== null) await writeFile(join(dir, "HANDOFF.diff"), diff);
  }

  it("throws when HANDOFF.md is missing", async () => {
    await expect(
      buildResume({
        projectRoot: dir,
        target: "generic",
        handoffFilename: "HANDOFF.md",
        diffFilename: "HANDOFF.diff",
        includeDiff: true,
      }),
    ).rejects.toThrow(/No HANDOFF.md/);
  });

  it("generic primer wraps handoff in BEGIN/END markers", async () => {
    await plant("# A\nbody");
    const r = await buildResume({
      projectRoot: dir,
      target: "generic",
      handoffFilename: "HANDOFF.md",
      diffFilename: "HANDOFF.diff",
      includeDiff: false,
    });
    expect(r.text).toContain("--- BEGIN HANDOFF ---");
    expect(r.text).toContain("--- END HANDOFF ---");
    expect(r.text).toContain("# A");
    expect(r.text).toContain("body");
  });

  it("includes diff section when includeDiff and file present and non-empty", async () => {
    await plant("h", "diff --git a/x b/x\n+new");
    const r = await buildResume({
      projectRoot: dir,
      target: "generic",
      handoffFilename: "HANDOFF.md",
      diffFilename: "HANDOFF.diff",
      includeDiff: true,
    });
    expect(r.text).toContain("--- BEGIN WORKING-TREE DIFF");
    expect(r.text).toContain("+new");
  });

  it("omits diff section when HANDOFF.diff is empty (no real changes)", async () => {
    await plant("h", "");
    const r = await buildResume({
      projectRoot: dir,
      target: "generic",
      handoffFilename: "HANDOFF.md",
      diffFilename: "HANDOFF.diff",
      includeDiff: true,
    });
    expect(r.text).not.toContain("WORKING-TREE DIFF");
  });

  it("omits diff section when includeDiff is false even if file exists", async () => {
    await plant("h", "actual content");
    const r = await buildResume({
      projectRoot: dir,
      target: "generic",
      handoffFilename: "HANDOFF.md",
      diffFilename: "HANDOFF.diff",
      includeDiff: false,
    });
    expect(r.text).not.toContain("WORKING-TREE DIFF");
    expect(r.source.diff).toBeNull();
  });

  it("cursor format uses fenced markdown sections", async () => {
    await plant("# h", "+x");
    const r = await buildResume({
      projectRoot: dir,
      target: "cursor",
      handoffFilename: "HANDOFF.md",
      diffFilename: "HANDOFF.diff",
      includeDiff: true,
    });
    expect(r.text).toContain("## Handoff");
    expect(r.text).toContain("```markdown");
    expect(r.text).toContain("```diff");
  });

  it("codex format uses ===== delimiters", async () => {
    await plant("h");
    const r = await buildResume({
      projectRoot: dir,
      target: "codex",
      handoffFilename: "HANDOFF.md",
      diffFilename: "HANDOFF.diff",
      includeDiff: false,
    });
    expect(r.text).toContain("===== HANDOFF.md =====");
    expect(r.text).toContain("===== END HANDOFF.md =====");
  });

  it("aider format includes # HANDOFF.md heading", async () => {
    await plant("h");
    const r = await buildResume({
      projectRoot: dir,
      target: "aider",
      handoffFilename: "HANDOFF.md",
      diffFilename: "HANDOFF.diff",
      includeDiff: false,
    });
    expect(r.text).toContain("# HANDOFF.md");
  });

  it("reports byte count and source paths", async () => {
    await plant("hello");
    const r = await buildResume({
      projectRoot: dir,
      target: "generic",
      handoffFilename: "HANDOFF.md",
      diffFilename: "HANDOFF.diff",
      includeDiff: false,
    });
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.source.handoff).toBe(join(dir, "HANDOFF.md"));
    expect(r.source.diff).toBeNull();
  });
});
