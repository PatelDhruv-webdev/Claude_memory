import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor, formatChecks, worstStatus } from "../src/doctor/run.js";
import { encodeProjectPath } from "../src/util/paths.js";
import { saveConfig, defaultConfig } from "../src/config/io.js";

describe("doctor", () => {
  const realHome = process.env.HOME;
  let fakeHome: string;
  let projectRoot: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "continuum-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "continuum-proj-"));
    process.env.HOME = fakeHome;
  });
  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    vi.unstubAllGlobals();
    await rm(fakeHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("fails when ~/.claude/projects doesn't exist", async () => {
    const checks = await runDoctor({ cwd: projectRoot });
    const proj = checks.find((c) => c.name.includes("Claude Code projects"));
    expect(proj!.status).toBe("fail");
  });

  it("reports session as ok when a JSONL exists for cwd", async () => {
    const sessionsDir = join(fakeHome, ".claude", "projects", encodeProjectPath(projectRoot));
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "x.jsonl"), "{}");
    const checks = await runDoctor({ cwd: projectRoot });
    const sess = checks.find((c) => c.name.includes("session for current dir"));
    expect(sess!.status).toBe("ok");
  });

  it("warns when no config is present", async () => {
    const checks = await runDoctor({ cwd: projectRoot });
    const cfg = checks.find((c) => c.name === "config");
    expect(cfg!.status).toBe("warn");
  });

  it("checks API key env when mode is external_api", async () => {
    const cfg = defaultConfig();
    cfg.mode = "external_api";
    cfg.external_api.api_key_env = "TEST_KEY_NOT_SET";
    await mkdir(join(fakeHome, ".continuum"), { recursive: true });
    await saveConfig(cfg, join(fakeHome, ".continuum", "config.yml"));

    delete process.env.TEST_KEY_NOT_SET;
    const checks = await runDoctor({ cwd: projectRoot });
    const key = checks.find((c) => c.name === "API key env");
    expect(key!.status).toBe("fail");
    expect(key!.message).toContain("TEST_KEY_NOT_SET");
  });

  it("reports API key env ok when it's set", async () => {
    const cfg = defaultConfig();
    cfg.mode = "external_api";
    cfg.external_api.api_key_env = "TEST_KEY_PRESENT";
    await mkdir(join(fakeHome, ".continuum"), { recursive: true });
    await saveConfig(cfg, join(fakeHome, ".continuum", "config.yml"));
    process.env.TEST_KEY_PRESENT = "sk-test";

    const checks = await runDoctor({ cwd: projectRoot });
    const key = checks.find((c) => c.name === "API key env");
    expect(key!.status).toBe("ok");

    delete process.env.TEST_KEY_PRESENT;
  });

  it("skips provider check when mode is factual_only", async () => {
    const cfg = defaultConfig();
    cfg.mode = "factual_only";
    await mkdir(join(fakeHome, ".continuum"), { recursive: true });
    await saveConfig(cfg, join(fakeHome, ".continuum", "config.yml"));

    const checks = await runDoctor({ cwd: projectRoot });
    const provider = checks.find((c) => c.name === "LLM provider");
    expect(provider!.status).toBe("skip");
  });
});

describe("formatChecks / worstStatus", () => {
  it("worstStatus picks fail over warn over ok", () => {
    expect(worstStatus([
      { name: "a", status: "ok", message: "" },
      { name: "b", status: "warn", message: "" },
      { name: "c", status: "fail", message: "" },
    ])).toBe("fail");
    expect(worstStatus([
      { name: "a", status: "ok", message: "" },
      { name: "b", status: "warn", message: "" },
    ])).toBe("warn");
    expect(worstStatus([
      { name: "a", status: "ok", message: "" },
    ])).toBe("ok");
  });

  it("formatChecks renders one line per check with hints indented", () => {
    const out = formatChecks([
      { name: "a", status: "ok", message: "fine" },
      { name: "b", status: "fail", message: "broken", hint: "do thing" },
    ]);
    expect(out).toContain("✓ a: fine");
    expect(out).toContain("✗ b: broken");
    expect(out).toContain("hint: do thing");
  });
});
