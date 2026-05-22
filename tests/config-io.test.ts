import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, defaultConfig } from "../src/config/io.js";

describe("config io", () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-cfg-"));
    path = join(dir, "config.yml");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the file doesn't exist", async () => {
    expect(await loadConfig(path)).toBeNull();
  });

  it("saves then loads roundtrip", async () => {
    const cfg = defaultConfig();
    await saveConfig(cfg, path);
    const back = await loadConfig(path);
    expect(back).not.toBeNull();
    expect(back!.mode).toBe(cfg.mode);
    expect(back!.snapshot.handoff_filename).toBe(cfg.snapshot.handoff_filename);
  });

  it("treats malformed YAML as missing and backs it up", async () => {
    await writeFile(path, "this is :: not :: { valid yaml");
    const back = await loadConfig(path);
    expect(back).toBeNull();
    const entries = await readdir(dir);
    expect(entries.some((e) => e.includes(".broken-"))).toBe(true);
  });

  it("treats wrong-schema YAML as missing and backs it up", async () => {
    await writeFile(path, "mode: not-a-valid-mode\n");
    const back = await loadConfig(path);
    expect(back).toBeNull();
    const entries = await readdir(dir);
    expect(entries.some((e) => e.includes(".broken-"))).toBe(true);
  });

  it("never writes a partial file when the parent dir is created", async () => {
    const deep = join(dir, "a", "b", "config.yml");
    await saveConfig(defaultConfig(), deep);
    const back = await readFile(deep, "utf8");
    expect(back).toContain("schema_version:");
  });

  it("defaultConfig() returns a fresh copy each call", async () => {
    const a = defaultConfig();
    const b = defaultConfig();
    a.snapshot.handoff_filename = "X.md";
    expect(b.snapshot.handoff_filename).toBe("HANDOFF.md");
  });
});
