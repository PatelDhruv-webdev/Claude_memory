import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/util/retry.js";

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn(async () => 42);
    const r = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(r).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to `retries` times before throwing the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("stops retrying when shouldRetry returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("auth");
    });
    await expect(
      withRetry(fn, {
        retries: 5,
        baseDelayMs: 1,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("auth");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry between attempts with attempt index and delay", async () => {
    const onRetry = vi.fn();
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });
    const r = await withRetry(fn, { retries: 5, baseDelayMs: 1, onRetry });
    expect(r).toBe("ok");
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("respects maxDelayMs cap", async () => {
    let lastDelay = 0;
    const fn = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(
      withRetry(fn, {
        retries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 50,
        onRetry: (_e, _a, delay) => {
          lastDelay = delay;
        },
      }),
    ).rejects.toThrow();
    expect(lastDelay).toBeLessThanOrEqual(50);
  });
});
