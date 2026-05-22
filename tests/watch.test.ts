import { describe, it, expect, vi, afterEach } from "vitest";
import { runWatch } from "../src/watch/run.js";
import type { Config } from "../src/config/schema.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

const BASE_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  mode: "factual_only",
  triggers: {
    on_error: false,
    on_idle: false,
    idle_minutes: 60,
    on_exit: false, // disable exit snapshot so SIGTERM doesn't try to snapshot
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  // Remove any SIGTERM listeners added by the test
  process.removeAllListeners("SIGTERM");
});

describe("runWatch", () => {
  it("logs the project root and configuration on startup", async () => {
    const messages: string[] = [];
    const out = {
      write: (s: string) => { messages.push(s); },
    } as NodeJS.WritableStream;

    // Mock startWatcher to do nothing and return a noop stopper
    vi.mock("../src/daemon/watcher.js", () => ({
      startWatcher: vi.fn().mockResolvedValue(async () => {}),
    }));

    // Spy on process.exit so SIGTERM doesn't kill the test runner
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    // runWatch runs forever; we start it and immediately emit SIGTERM
    const watchPromise = runWatch({
      projectRoot: "/test/project",
      config: BASE_CONFIG,
      out,
    });

    // Give it a tick to register the signal handler and log startup messages
    await new Promise((r) => setTimeout(r, 30));

    // Trigger cleanup via SIGTERM
    process.emit("SIGTERM");

    // Wait for cleanup to finish
    await new Promise((r) => setTimeout(r, 50));

    // Verify startup messages were logged
    const combined = messages.join("");
    expect(combined).toContain("watching /test/project");
    expect(combined).toContain("idle trigger");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("logs press Ctrl+C message", async () => {
    const messages: string[] = [];
    const out = {
      write: (s: string) => { messages.push(s); },
    } as NodeJS.WritableStream;

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const _watchPromise = runWatch({
      projectRoot: "/test/project2",
      config: BASE_CONFIG,
      out,
    });

    await new Promise((r) => setTimeout(r, 30));
    process.emit("SIGTERM");
    await new Promise((r) => setTimeout(r, 50));

    const combined = messages.join("");
    expect(combined).toContain("Ctrl+C");
    expect(exitSpy).toHaveBeenCalled();
  });
});
