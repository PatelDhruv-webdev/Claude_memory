import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { snapshot } from "../src/snapshot/index.js";
import { defaultConfig } from "../src/config/io.js";
import { encodeProjectPath } from "../src/util/paths.js";
import { NoSessionError } from "../src/util/errors.js";

const FIXTURES = join(__dirname, "fixtures");

describe("snapshot end-to-end", () => {
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

  async function plantSession(fixture: string): Promise<void> {
    await copyFile(join(FIXTURES, fixture), join(sessionsDir, fixture));
  }

  it("throws NoSessionError when there is no session file", async () => {
    await expect(
      snapshot({ cwd: projectRoot, config: defaultConfig() }),
    ).rejects.toBeInstanceOf(NoSessionError);
  });

  it("writes HANDOFF.md and HANDOFF.diff to the project root", async () => {
    await plantSession("session-clean-end.jsonl");
    const r = await snapshot({ cwd: projectRoot, config: defaultConfig() });
    expect(existsSync(r.handoffPath)).toBe(true);
    expect(existsSync(r.diffPath)).toBe(true);
    const md = await readFile(r.handoffPath, "utf8");
    expect(md).toContain("# Session Handoff");
    expect(md).toContain("Add a hello function");
  });

  it("rotates a previous HANDOFF.md into ~/.continuum/history", async () => {
    await plantSession("session-clean-end.jsonl");
    await writeFile(join(projectRoot, "HANDOFF.md"), "old version");
    await snapshot({ cwd: projectRoot, config: defaultConfig() });
    const histDir = join(fakeHome, ".continuum", "history", encodeProjectPath(projectRoot));
    const entries = await readdir(histDir);
    expect(entries.length).toBe(1);
    expect((await readFile(join(histDir, entries[0]!), "utf8"))).toBe("old version");
  });

  it("writes the diff body to HANDOFF.diff (separate file)", async () => {
    await plantSession("session-clean-end.jsonl");
    const r = await snapshot({ cwd: projectRoot, config: defaultConfig() });
    const diff = await readFile(r.diffPath, "utf8");
    // Not a git repo in this test, so diff is empty string — but the file exists.
    expect(typeof diff).toBe("string");
  });

  it("does not leave a .tmp- file on success", async () => {
    await plantSession("session-clean-end.jsonl");
    await snapshot({ cwd: projectRoot, config: defaultConfig() });
    const entries = await readdir(projectRoot);
    expect(entries.filter((e) => e.includes(".tmp-"))).toEqual([]);
  });

  it("uses the provided narrative sections in the output", async () => {
    await plantSession("session-clean-end.jsonl");
    const r = await snapshot({
      cwd: projectRoot,
      config: defaultConfig(),
      narrative: {
        what_we_did: "- created hello.ts",
        decisions_made: "",
        rejected_approaches: "",
      },
    });
    const md = await readFile(r.handoffPath, "utf8");
    expect(md).toContain("- created hello.ts");
    expect(md).not.toMatch(/## What We Did\n_\(not generated/);
  });
});
