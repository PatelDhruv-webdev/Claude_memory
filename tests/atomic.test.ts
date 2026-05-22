import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../src/util/atomic.js";

describe("writeFileAtomic", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-atomic-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a new file", async () => {
    const path = join(dir, "out.txt");
    await writeFileAtomic(path, "hello");
    expect(await readFile(path, "utf8")).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const path = join(dir, "out.txt");
    await writeFileAtomic(path, "v1");
    await writeFileAtomic(path, "v2");
    expect(await readFile(path, "utf8")).toBe("v2");
  });

  it("creates missing parent directories", async () => {
    const path = join(dir, "a", "b", "c", "out.txt");
    await writeFileAtomic(path, "deep");
    expect(await readFile(path, "utf8")).toBe("deep");
  });

  it("never leaves a .tmp- sibling on success", async () => {
    const path = join(dir, "out.txt");
    await writeFileAtomic(path, "hello");
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.includes(".tmp-"))).toEqual([]);
  });

  it("handles binary content", async () => {
    const path = join(dir, "bin");
    const buf = new Uint8Array([0, 1, 2, 255, 254]);
    await writeFileAtomic(path, buf);
    const back = await readFile(path);
    expect(back).toEqual(Buffer.from(buf));
  });

  it("supports unicode and long content", async () => {
    const path = join(dir, "out.txt");
    const content = "héllo 🦊 " + "x".repeat(10_000);
    await writeFileAtomic(path, content);
    expect(await readFile(path, "utf8")).toBe(content);
  });
});
