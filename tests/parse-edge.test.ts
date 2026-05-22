import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionFile } from "../src/snapshot/parse.js";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("parseSessionFile edge cases", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-parse-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("handles an empty file", async () => {
    const p = join(dir, "empty.jsonl");
    await writeFile(p, "");
    expect((await collect(parseSessionFile(p))).length).toBe(0);
  });

  it("skips blank lines without error", async () => {
    const p = join(dir, "blanks.jsonl");
    await writeFile(p, "\n\n\n");
    expect((await collect(parseSessionFile(p))).length).toBe(0);
  });

  it("ignores trailing partial line", async () => {
    const p = join(dir, "partial.jsonl");
    const good = JSON.stringify({ type: "user", message: { role: "user", content: "hi" } });
    await writeFile(p, good + "\n{\"type\":\"assistant\", \"message\":{\"role\":\"as");
    const events = await collect(parseSessionFile(p));
    expect(events.length).toBe(1);
  });

  it("survives very long single lines", async () => {
    const p = join(dir, "long.jsonl");
    const huge = "x".repeat(2 * 1024 * 1024);
    const obj = { type: "user", message: { role: "user", content: huge } };
    await writeFile(p, JSON.stringify(obj) + "\n");
    const events = await collect(parseSessionFile(p));
    expect(events.length).toBe(1);
  });

  it("drops isMeta:true events at the parse stage", async () => {
    const p = join(dir, "meta.jsonl");
    const lines = [
      JSON.stringify({ type: "user", isMeta: true, message: { role: "user", content: "x" } }),
      JSON.stringify({ type: "user", message: { role: "user", content: "real" } }),
    ];
    await writeFile(p, lines.join("\n") + "\n");
    const events = await collect(parseSessionFile(p));
    expect(events.length).toBe(1);
  });

  it("skips invalid-schema lines without throwing", async () => {
    const p = join(dir, "weird.jsonl");
    const lines = [
      JSON.stringify({ no_type_field: true }),
      JSON.stringify({ type: "user", message: { role: "user", content: "ok" } }),
      "[]", // array, not object
      "42", // number
      "null",
    ];
    await writeFile(p, lines.join("\n") + "\n");
    const events = await collect(parseSessionFile(p));
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("user");
  });
});
