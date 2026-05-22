import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitInfo } from "./types.js";

const exec = promisify(execFile);

async function tryGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout.replace(/\n$/, "");
  } catch {
    return null;
  }
}

export async function getGitInfo(cwd: string): Promise<GitInfo> {
  const inRepo = await tryGit(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inRepo !== "true") {
    return {
      branch: "(not a git repo)",
      lastCommit: "(not a git repo)",
      status: "",
      diff: "",
      isRepo: false,
    };
  }

  const [branch, lastCommit, status, diff] = await Promise.all([
    tryGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    tryGit(["log", "-1", "--format=%h %s"], cwd),
    tryGit(["status", "--short"], cwd),
    tryGit(["diff", "HEAD"], cwd),
  ]);

  return {
    branch: branch ?? "(unknown)",
    lastCommit: lastCommit ?? "(no commits)",
    status: status ?? "",
    diff: diff ?? "",
    isRepo: true,
  };
}
