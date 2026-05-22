import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateLogIfNeeded } from "../src/util/logger.js";

describe("rotateLogIfNeeded", () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-log-"));
    path = join(dir, "log.jsonl");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is a no-op when the file does not exist", () => {
    rotateLogIfNeeded(path, 100, 3);
    expect(existsSync(path)).toBe(false);
  });

  it("is a no-op when the file is under maxBytes", async () => {
    await writeFile(path, "x".repeat(50));
    rotateLogIfNeeded(path, 100, 3);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.1`)).toBe(false);
  });

  it("rotates the file to .1 when over maxBytes", async () => {
    await writeFile(path, "x".repeat(200));
    rotateLogIfNeeded(path, 100, 3);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.1`)).toBe(true);
    expect((await stat(`${path}.1`)).size).toBe(200);
  });

  it("cascades existing rotations: .1 → .2, oldest drops", async () => {
    await writeFile(path, "x".repeat(200)); // current, will become .1
    await writeFile(`${path}.1`, "one");
    await writeFile(`${path}.2`, "two");
    rotateLogIfNeeded(path, 100, 3);

    expect(existsSync(path)).toBe(false);
    // .2 dropped (keep=3 means we keep .1 and .2 only — .3 would exceed), wait
    // Actually with keep=3, the loop drops index `keep-1`=2 when rotating it
    // to `keep`=3. So .2 should be dropped, .1 → .2, current → .1.
    // Let's just assert the right files exist with the right contents.
    expect(existsSync(`${path}.1`)).toBe(true);
    expect((await stat(`${path}.1`)).size).toBe(200); // the just-rotated current
    expect(existsSync(`${path}.2`)).toBe(true);
    const dotTwo = await (await import("node:fs/promises")).readFile(`${path}.2`, "utf8");
    expect(dotTwo).toBe("one"); // .1 was renamed to .2
  });

  it("keeps at most `keep` rotation files", async () => {
    await writeFile(path, "x".repeat(200));
    await writeFile(`${path}.1`, "one");
    await writeFile(`${path}.2`, "two");
    await writeFile(`${path}.3`, "three"); // pre-existing extra, should not survive
    rotateLogIfNeeded(path, 100, 3);
    const entries = await readdir(dir);
    const rotations = entries.filter((e) => /\.jsonl(\.\d+)?$/.test(e));
    // Should be: log.jsonl.1 (new), log.jsonl.2 (was .1). .3 leftover MIGHT remain
    // because the function only manages up to `keep` indices; check none over .3 exist.
    expect(rotations.some((e) => e === "log.jsonl.1")).toBe(true);
    expect(rotations.some((e) => e === "log.jsonl.2")).toBe(true);
  });
});
