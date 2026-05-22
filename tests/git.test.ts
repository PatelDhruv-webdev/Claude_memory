import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGitInfo } from "../src/snapshot/git.js";

const exec = promisify(execFile);

describe("getGitInfo", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-git-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns isRepo=false when cwd is not a git repo", async () => {
    const info = await getGitInfo(dir);
    expect(info.isRepo).toBe(false);
    expect(info.branch).toContain("not a git repo");
  });

  it("returns branch, last commit, and clean status for a fresh repo with one commit", async () => {
    await exec("git", ["init", "-q", "-b", "main"], { cwd: dir });
    await exec("git", ["config", "user.email", "t@e"], { cwd: dir });
    await exec("git", ["config", "user.name", "T"], { cwd: dir });
    await exec("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
    await writeFile(join(dir, "README.md"), "hi");
    await exec("git", ["add", "."], { cwd: dir });
    await exec("git", ["commit", "-q", "-m", "init"], { cwd: dir });

    const info = await getGitInfo(dir);
    expect(info.isRepo).toBe(true);
    expect(info.branch).toBe("main");
    expect(info.lastCommit).toContain("init");
    expect(info.status.trim()).toBe("");
  });

  it("captures uncommitted changes in status and diff", async () => {
    await exec("git", ["init", "-q", "-b", "main"], { cwd: dir });
    await exec("git", ["config", "user.email", "t@e"], { cwd: dir });
    await exec("git", ["config", "user.name", "T"], { cwd: dir });
    await exec("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
    await writeFile(join(dir, "f.txt"), "v1\n");
    await exec("git", ["add", "."], { cwd: dir });
    await exec("git", ["commit", "-q", "-m", "first"], { cwd: dir });
    await writeFile(join(dir, "f.txt"), "v2\n");

    const info = await getGitInfo(dir);
    expect(info.status).toContain("f.txt");
    expect(info.diff).toContain("-v1");
    expect(info.diff).toContain("+v2");
  });
});
