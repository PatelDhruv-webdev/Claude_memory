import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readLivePid, writePid, isAlive, clearPid } from "../src/daemon/pidfile.js";

describe("pidfile", () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-pid-"));
    path = join(dir, "daemon.pid");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when no PID file exists", async () => {
    expect(await readLivePid(path)).toBeNull();
  });

  it("write/read roundtrip with current process PID", async () => {
    await writePid(path, { pid: process.pid, projectRoot: "/p", startedAt: "t" });
    const r = await readLivePid(path);
    expect(r).not.toBeNull();
    expect(r!.pid).toBe(process.pid);
  });

  it("treats malformed JSON as no daemon and removes the file", async () => {
    await writeFile(path, "{not json");
    expect(await readLivePid(path)).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it("treats a dead PID as no daemon and removes the file", async () => {
    // pid 999999 almost certainly doesn't exist on this machine
    await writeFile(path, JSON.stringify({ pid: 999_999, projectRoot: "/p", startedAt: "t" }));
    expect(await readLivePid(path)).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it("isAlive rejects non-positive and non-integer PIDs", () => {
    expect(isAlive(0)).toBe(false);
    expect(isAlive(-1)).toBe(false);
    expect(isAlive(Number.NaN)).toBe(false);
    expect(isAlive(1.5)).toBe(false);
  });

  it("clearPid removes the file if present, is a no-op if absent", async () => {
    await writeFile(path, "{}");
    await clearPid(path);
    expect(existsSync(path)).toBe(false);
    await clearPid(path); // no throw
  });

  it("writePid writes valid JSON", async () => {
    await writePid(path, { pid: process.pid, projectRoot: "/x", startedAt: "2026-05-22" });
    const back = JSON.parse(await readFile(path, "utf8"));
    expect(back.pid).toBe(process.pid);
    expect(back.projectRoot).toBe("/x");
  });
});
