import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tailLines } from "../src/util/tail.js";

let tmp: string;

async function setup(): Promise<string> {
  tmp = await mkdtemp(join(tmpdir(), "continuum-tail-"));
  return tmp;
}

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("tailLines", () => {
  it("returns empty array for n=0", async () => {
    const dir = await setup();
    const f = join(dir, "test.txt");
    await writeFile(f, "line1\nline2\n");
    expect(await tailLines(f, 0)).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    const dir = await setup();
    const f = join(dir, "empty.txt");
    await writeFile(f, "");
    expect(await tailLines(f, 5)).toEqual([]);
  });

  it("returns all lines when file has fewer than n lines", async () => {
    const dir = await setup();
    const f = join(dir, "short.txt");
    await writeFile(f, "alpha\nbeta\ngamma\n");
    const lines = await tailLines(f, 10);
    expect(lines).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns exactly the last n lines", async () => {
    const dir = await setup();
    const f = join(dir, "test.txt");
    const content = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    await writeFile(f, content);
    const lines = await tailLines(f, 5);
    expect(lines).toEqual(["line16", "line17", "line18", "line19", "line20"]);
  });

  it("handles files without trailing newline", async () => {
    const dir = await setup();
    const f = join(dir, "nonewline.txt");
    await writeFile(f, "a\nb\nc");
    const lines = await tailLines(f, 2);
    expect(lines).toEqual(["b", "c"]);
  });

  it("works correctly when n equals exact line count", async () => {
    const dir = await setup();
    const f = join(dir, "exact.txt");
    await writeFile(f, "x\ny\nz\n");
    const lines = await tailLines(f, 3);
    expect(lines).toEqual(["x", "y", "z"]);
  });

  it("handles single-line file", async () => {
    const dir = await setup();
    const f = join(dir, "single.txt");
    await writeFile(f, "only line\n");
    const lines = await tailLines(f, 5);
    expect(lines).toEqual(["only line"]);
  });

  it("reads correctly across chunk boundaries (large file)", async () => {
    const dir = await setup();
    const f = join(dir, "large.txt");
    // Write 1000 lines, each ~50 chars, well over the 16KB chunk size
    const lines = Array.from({ length: 1000 }, (_, i) => `line-${String(i).padStart(4, "0")}-${"x".repeat(40)}`);
    await writeFile(f, lines.join("\n") + "\n");
    const tail = await tailLines(f, 10);
    expect(tail).toHaveLength(10);
    expect(tail[0]).toBe(lines[990]);
    expect(tail[9]).toBe(lines[999]);
  });
});
