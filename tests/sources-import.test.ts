import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectKind, importSession } from "../src/sources/import.js";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("detectKind", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-detect-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("detects .jsonl files as claude-code", async () => {
    const p = join(dir, "session.jsonl");
    await writeFile(p, '{"type":"user","message":{"role":"user","content":"hi"}}');
    expect(await detectKind(p)).toBe("claude-code");
  });

  it("detects .aider.chat.history.md filenames as aider", async () => {
    const p = join(dir, ".aider.chat.history.md");
    await writeFile(p, "# aider chat started at 2026-01-01");
    expect(await detectKind(p)).toBe("aider");
  });

  it("detects aider by header content even with arbitrary filename", async () => {
    const p = join(dir, "history.md");
    await writeFile(p, "# aider chat started at 2026-01-01\n\n> hi\n");
    expect(await detectKind(p)).toBe("aider");
  });

  it("detects markdown transcript by role headings", async () => {
    const p = join(dir, "chat.md");
    await writeFile(p, "# User\nhi\n\n# Assistant\nhello");
    expect(await detectKind(p)).toBe("markdown");
  });

  it("throws when the file does not exist", async () => {
    await expect(detectKind(join(dir, "nope"))).rejects.toThrow(/not found/);
  });
});

describe("importSession (end-to-end format dispatch)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-import-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("imports aider transcripts", async () => {
    const p = join(dir, ".aider.chat.history.md");
    await writeFile(p, "# aider chat started at 2026-01-01\n\n> hi\n\nhello\n");
    const events = await collect(importSession({ kind: "auto", path: p }));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.message!.role).toBe("user");
  });

  it("imports markdown transcripts", async () => {
    const p = join(dir, "chat.md");
    await writeFile(p, "# User\ndo X\n\n# Assistant\ndid X");
    const events = await collect(importSession({ kind: "markdown", path: p }));
    expect(events.length).toBe(2);
  });

  it("explicit --from overrides auto-detection", async () => {
    const p = join(dir, "ambiguous.md");
    await writeFile(p, "# User\nhi\n\n# Assistant\nbye");
    const events = await collect(importSession({ kind: "markdown", path: p }));
    expect(events.length).toBe(2);
  });
});
