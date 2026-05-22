import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateOpenAIKey } from "../src/providers/openai.js";
import { validateAnthropicKey } from "../src/providers/anthropic.js";
import { ProviderError } from "../src/util/errors.js";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("validateOpenAIKey", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns ok=true on 200", async () => {
    mockFetch(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const r = await validateOpenAIKey({ apiKey: "sk-abc" });
    expect(r.ok).toBe(true);
  });

  it("returns ok=false on 401", async () => {
    mockFetch(async () => new Response("nope", { status: 401 }));
    const r = await validateOpenAIKey({ apiKey: "bad" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("returns ok=true on 429 (rate limited but key valid)", async () => {
    mockFetch(async () => new Response("slow down", { status: 429 }));
    const r = await validateOpenAIKey({ apiKey: "sk-abc" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(429);
  });

  it("rejects empty/whitespace key without making a request", async () => {
    const spy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const r = await validateOpenAIKey({ apiKey: "   " });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("throws ProviderError on network failure", async () => {
    mockFetch(async () => {
      throw new Error("ENOTFOUND");
    });
    await expect(validateOpenAIKey({ apiKey: "sk-abc" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("trims surrounding whitespace from the key", async () => {
    let seenAuth: string | undefined;
    mockFetch(async (_url, init) => {
      seenAuth = (init?.headers as Record<string, string>)?.authorization;
      return new Response("{}", { status: 200 });
    });
    await validateOpenAIKey({ apiKey: "  sk-xyz  \n" });
    expect(seenAuth).toBe("Bearer sk-xyz");
  });
});

describe("validateAnthropicKey", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns ok=true on 200", async () => {
    mockFetch(async () => new Response(JSON.stringify({ content: [] }), { status: 200 }));
    expect((await validateAnthropicKey({ apiKey: "ant-key" })).ok).toBe(true);
  });

  it("returns ok=false on 401", async () => {
    mockFetch(async () => new Response("", { status: 401 }));
    expect((await validateAnthropicKey({ apiKey: "bad" })).ok).toBe(false);
  });

  it("returns ok=false with helpful message on 404 (model not found)", async () => {
    mockFetch(async () => new Response("", { status: 404 }));
    const r = await validateAnthropicKey({ apiKey: "k", model: "nonexistent" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("nonexistent");
  });

  it("throws ProviderError on network failure", async () => {
    mockFetch(async () => {
      throw new Error("ENETUNREACH");
    });
    await expect(validateAnthropicKey({ apiKey: "k" })).rejects.toBeInstanceOf(ProviderError);
  });
});
