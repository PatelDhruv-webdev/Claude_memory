import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSession } from "../src/snapshot/discover.js";
import { encodeProjectPath } from "../src/util/paths.js";

/**
 * discoverSession reads from ~/.claude/projects. We override HOME so the
 * test doesn't touch the user's real config. encodeProjectPath uses
 * path.resolve internally so a tmpdir-based project path works fine.
 */
describe("discoverSession", () => {
  const realHome = process.env.HOME;
  let fakeHome: string;
  let projectRoot: string;
  let sessionsDir: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "continuum-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "continuum-proj-"));
    process.env.HOME = fakeHome;
    sessionsDir = join(fakeHome, ".claude", "projects", encodeProjectPath(projectRoot));
    await mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    await rm(fakeHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("returns null when the project directory doesn't exist", async () => {
    await rm(sessionsDir, { recursive: true, force: true });
    expect(await discoverSession(projectRoot)).toBeNull();
  });

  it("returns null when no .jsonl files are present", async () => {
    await writeFile(join(sessionsDir, "notes.txt"), "");
    expect(await discoverSession(projectRoot)).toBeNull();
  });

  it("picks the most recently modified .jsonl", async () => {
    const a = join(sessionsDir, "old.jsonl");
    const b = join(sessionsDir, "new.jsonl");
    await writeFile(a, "");
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(b, "");
    expect(await discoverSession(projectRoot)).toBe(b);
  });

  it("excludes agent-*.jsonl subagent files", async () => {
    const main = join(sessionsDir, "main.jsonl");
    const agent = join(sessionsDir, "agent-deep-research.jsonl");
    await writeFile(main, "");
    await new Promise((r) => setTimeout(r, 20));
    // agent file is newer — should still be skipped
    await writeFile(agent, "");
    expect(await discoverSession(projectRoot)).toBe(main);
  });

  it("returns null when only agent-*.jsonl files exist", async () => {
    await writeFile(join(sessionsDir, "agent-x.jsonl"), "");
    expect(await discoverSession(projectRoot)).toBeNull();
  });
});
