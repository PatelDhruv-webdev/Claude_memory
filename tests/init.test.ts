import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/init/run.js";

describe("init", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "continuum-init-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a fresh .gitignore with HANDOFF entries", async () => {
    const r = await runInit({ cwd: dir });
    expect(r.steps[0]!.status).toBe("done");
    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gi).toContain("HANDOFF.md");
    expect(gi).toContain("HANDOFF.diff");
    expect(gi).toContain("# Added by continuum");
  });

  it("appends only missing entries to an existing .gitignore", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules\nHANDOFF.md\n");
    const r = await runInit({ cwd: dir });
    expect(r.steps[0]!.status).toBe("done");
    expect(r.steps[0]!.detail).toContain("HANDOFF.diff");
    expect(r.steps[0]!.detail).not.toContain("HANDOFF.md");
    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    // node_modules preserved
    expect(gi).toContain("node_modules");
    // HANDOFF.md not duplicated
    expect(gi.match(/HANDOFF\.md/g)!.length).toBe(1);
    expect(gi).toContain("HANDOFF.diff");
  });

  it("is a no-op when both entries already present", async () => {
    await writeFile(join(dir, ".gitignore"), "HANDOFF.md\nHANDOFF.diff\n");
    const r = await runInit({ cwd: dir });
    expect(r.steps[0]!.status).toBe("skipped");
  });

  it("respects custom handoff filenames in config", async () => {
    const r = await runInit({
      cwd: dir,
      handoffFilename: "RESUME.md",
      diffFilename: "RESUME.diff",
    });
    expect(r.steps[0]!.status).toBe("done");
    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gi).toContain("RESUME.md");
    expect(gi).toContain("RESUME.diff");
  });

  it("writes project config when --with-config and skips on re-run", async () => {
    const r1 = await runInit({ cwd: dir, withProjectConfig: true });
    const cfgStep = r1.steps.find((s) => s.name === ".continuum/config.yml");
    expect(cfgStep!.status).toBe("done");
    expect(existsSync(join(dir, ".continuum", "config.yml"))).toBe(true);

    const r2 = await runInit({ cwd: dir, withProjectConfig: true });
    const cfgStep2 = r2.steps.find((s) => s.name === ".continuum/config.yml");
    expect(cfgStep2!.status).toBe("skipped");
  });

  it("treats /HANDOFF.md style entries as already-present", async () => {
    await writeFile(join(dir, ".gitignore"), "/HANDOFF.md\n/HANDOFF.diff\n");
    const r = await runInit({ cwd: dir });
    expect(r.steps[0]!.status).toBe("skipped");
  });
});
