import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateOpenRouterKey } from "../src/providers/openrouter.js";
import { ProviderError } from "../src/util/errors.js";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("validateOpenRouterKey", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns ok=false for empty key without making a request", async () => {
    const spy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const r = await validateOpenRouterKey({ apiKey: "" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns ok=false for whitespace-only key", async () => {
    const spy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const r = await validateOpenRouterKey({ apiKey: "   " });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns ok=true on 200", async () => {
    mockFetch(async () => new Response(JSON.stringify({ data: { label: "test" } }), { status: 200 }));
    const r = await validateOpenRouterKey({ apiKey: "sk-or-abc123" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
  });

  it("returns ok=false on 401 (bad key)", async () => {
    mockFetch(async () => new Response("Unauthorized", { status: 401 }));
    const r = await validateOpenRouterKey({ apiKey: "bad-key" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.message).toMatch(/invalid|unauthorized/i);
  });

  it("returns ok=false on 403", async () => {
    mockFetch(async () => new Response("Forbidden", { status: 403 }));
    const r = await validateOpenRouterKey({ apiKey: "sk-or-forbidden" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it("returns ok=true on 429 (rate-limited but key valid)", async () => {
    mockFetch(async () => new Response("slow down", { status: 429 }));
    const r = await validateOpenRouterKey({ apiKey: "sk-or-abc" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(429);
    expect(r.message).toMatch(/rate.limit/i);
  });

  it("throws ProviderError on network failure", async () => {
    mockFetch(async () => { throw new Error("ENOTFOUND"); });
    await expect(validateOpenRouterKey({ apiKey: "sk-or-abc" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("trims surrounding whitespace from the key", async () => {
    let seenAuth: string | undefined;
    mockFetch(async (_url, init) => {
      seenAuth = (init?.headers as Record<string, string>)?.authorization;
      return new Response("{}", { status: 200 });
    });
    await validateOpenRouterKey({ apiKey: "  sk-or-xyz  \n" });
    expect(seenAuth).toBe("Bearer sk-or-xyz");
  });

  it("hits the correct OpenRouter endpoint", async () => {
    let seenUrl = "";
    mockFetch(async (url) => {
      seenUrl = url as string;
      return new Response("{}", { status: 200 });
    });
    await validateOpenRouterKey({ apiKey: "sk-or-abc", baseUrl: "https://openrouter.ai" });
    expect(seenUrl).toBe("https://openrouter.ai/api/v1/auth/key");
  });
});
