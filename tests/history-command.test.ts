import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listHistory, readHistoryEntry, clearHistory } from "../src/snapshot/history.js";

let tmp: string;

// We need to override continuumDir() to use a temp dir.
vi.mock("../src/util/paths.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/util/paths.js")>();
  return {
    ...orig,
    continuumDir: () => tmp,
  };
});

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function makeHistoryDir(projectRoot: string): Promise<string> {
  // encodeProjectPath replaces "/" with "-"
  const encoded = projectRoot.replaceAll("/", "-");
  const dir = join(tmp, "history", encoded);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeEntry(dir: string, ts: string, content: string): Promise<void> {
  const name = `HANDOFF-${ts}.md`;
  await writeFile(join(dir, name), content, "utf8");
}

describe("history command helpers", () => {
  it("listHistory returns empty array when no history exists", async () => {
    tmp = await mkdtemp(join(tmpdir(), "continuum-histcmd-"));
    const entries = await listHistory("/my/project");
    expect(entries).toEqual([]);
  });

  it("listHistory returns entries newest first", async () => {
    tmp = await mkdtemp(join(tmpdir(), "continuum-histcmd-"));
    const dir = await makeHistoryDir("/my/project");
    await writeEntry(dir, "2026-05-22T10-00-00-000Z", "# old");
    await writeEntry(dir, "2026-05-22T12-00-00-000Z", "# middle");
    await writeEntry(dir, "2026-05-22T14-00-00-000Z", "# newest");

    const entries = await listHistory("/my/project");
    expect(entries).toHaveLength(3);
    expect(entries[0]!.name).toBe("HANDOFF-2026-05-22T14-00-00-000Z.md");
    expect(entries[2]!.name).toBe("HANDOFF-2026-05-22T10-00-00-000Z.md");
  });

  it("listHistory parses timestamps correctly", async () => {
    tmp = await mkdtemp(join(tmpdir(), "continuum-histcmd-"));
    const dir = await makeHistoryDir("/my/project");
    await writeEntry(dir, "2026-05-22T14-30-45-123Z", "content");

    const entries = await listHistory("/my/project");
    expect(entries[0]!.timestamp.toISOString()).toBe("2026-05-22T14:30:45.123Z");
  });

  it("readHistoryEntry returns content for index 1 (most recent)", async () => {
    tmp = await mkdtemp(join(tmpdir(), "continuum-histcmd-"));
    const dir = await makeHistoryDir("/my/project");
    await writeEntry(dir, "2026-05-22T10-00-00-000Z", "# old content");
    await writeEntry(dir, "2026-05-22T12-00-00-000Z", "# recent content");

    const content = await readHistoryEntry("/my/project", 1);
    expect(content).toBe("# recent content");
  });

  it("readHistoryEntry returns null for out-of-range index", async () => {
    tmp = await mkdtemp(join(tmpdir(), "continuum-histcmd-"));
    await makeHistoryDir("/my/project");
    const content = await readHistoryEntry("/my/project", 99);
    expect(content).toBeNull();
  });

  it("clearHistory removes all entries and returns count", async () => {
    tmp = await mkdtemp(join(tmpdir(), "continuum-histcmd-"));
    const dir = await makeHistoryDir("/my/project");
    await writeEntry(dir, "2026-05-22T10-00-00-000Z", "a");
    await writeEntry(dir, "2026-05-22T11-00-00-000Z", "b");
    await writeEntry(dir, "2026-05-22T12-00-00-000Z", "c");

    const removed = await clearHistory("/my/project");
    expect(removed).toBe(3);

    const remaining = await listHistory("/my/project");
    expect(remaining).toHaveLength(0);
  });

  it("clearHistory returns 0 when nothing to clear", async () => {
    tmp = await mkdtemp(join(tmpdir(), "continuum-histcmd-"));
    const removed = await clearHistory("/no/history/here");
    expect(removed).toBe(0);
  });
});
