import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readdir, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateHandoff } from "../src/snapshot/history.js";
import { encodeProjectPath } from "../src/util/paths.js";

describe("rotateHandoff", () => {
  const realHome = process.env.HOME;
  let fakeHome: string;
  let projectRoot: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "continuum-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "continuum-proj-"));
    process.env.HOME = fakeHome;
  });
  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    await rm(fakeHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("no-op when source HANDOFF.md does not exist", async () => {
    await rotateHandoff(projectRoot, join(projectRoot, "HANDOFF.md"), 5);
    // Should not throw and should not create history dir
    const histDir = join(fakeHome, ".continuum", "history", encodeProjectPath(projectRoot));
    let entries: string[] = [];
    try {
      entries = await readdir(histDir);
    } catch {
      /* expected */
    }
    expect(entries.length).toBe(0);
  });

  it("moves an existing HANDOFF.md into history with timestamped name", async () => {
    const cur = join(projectRoot, "HANDOFF.md");
    await writeFile(cur, "v1");
    await rotateHandoff(projectRoot, cur, 5);
    const histDir = join(fakeHome, ".continuum", "history", encodeProjectPath(projectRoot));
    const entries = await readdir(histDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^HANDOFF-.*\.md$/);
  });

  it("prunes oldest entries above the keep limit", async () => {
    const histDir = join(fakeHome, ".continuum", "history", encodeProjectPath(projectRoot));
    await mkdir(histDir, { recursive: true });

    // Pre-seed 5 history entries with sortable names.
    for (let i = 1; i <= 5; i++) {
      await writeFile(join(histDir, `HANDOFF-2026-05-22T10-00-0${i}-000Z.md`), `v${i}`);
    }
    // Rotate a 6th into history with keep=3
    const cur = join(projectRoot, "HANDOFF.md");
    await writeFile(cur, "v6");
    await rotateHandoff(projectRoot, cur, 3);

    const remaining = (await readdir(histDir)).sort();
    expect(remaining.length).toBe(3);
    // Oldest three should be gone
    expect(remaining.some((n) => n.includes("10-00-01"))).toBe(false);
    expect(remaining.some((n) => n.includes("10-00-02"))).toBe(false);
    expect(remaining.some((n) => n.includes("10-00-03"))).toBe(false);
  });

  it("with keep=0 removes the current handoff instead of archiving", async () => {
    const cur = join(projectRoot, "HANDOFF.md");
    await writeFile(cur, "v1");
    await rotateHandoff(projectRoot, cur, 0);
    const histDir = join(fakeHome, ".continuum", "history", encodeProjectPath(projectRoot));
    let entries: string[] = [];
    try {
      entries = await readdir(histDir);
    } catch {
      /* expected */
    }
    expect(entries.length).toBe(0);
    // And the cur is gone too
    let exists = true;
    try {
      await readdir(projectRoot);
      const e = await readdir(projectRoot);
      exists = e.includes("HANDOFF.md");
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
