import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isOllamaInstalled,
  isOllamaRunning,
  pullModel,
} from "../src/providers/ollama.js";
import { InstallError } from "../src/util/errors.js";

describe("ollama detection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("isOllamaRunning returns false when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await isOllamaRunning()).toBe(false);
  });

  it("isOllamaRunning returns true on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }),
    ));
    expect(await isOllamaRunning()).toBe(true);
  });

  it("isOllamaInstalled uses injected whichImpl", async () => {
    expect(await isOllamaInstalled({ whichImpl: async () => "/usr/bin/ollama" })).toBe(true);
    expect(await isOllamaInstalled({ whichImpl: async () => null })).toBe(false);
  });
});

describe("pullModel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams NDJSON progress events to the callback", async () => {
    const ndjson = [
      '{"status":"pulling manifest"}',
      '{"status":"downloading","total":1000,"completed":250}',
      '{"status":"downloading","total":1000,"completed":1000}',
      '{"status":"success"}',
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(ndjson, { status: 200 }),
    ));
    const progress: string[] = [];
    await pullModel({
      model: "qwen2.5:3b",
      onProgress: (p) => progress.push(p.status),
    });
    expect(progress).toEqual([
      "pulling manifest",
      "downloading",
      "downloading",
      "success",
    ]);
  });

  it("throws InstallError on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("not found", { status: 404 }),
    ));
    await expect(pullModel({ model: "bogus" })).rejects.toBeInstanceOf(InstallError);
  });

  it("throws InstallError when a stream event has an error field", async () => {
    const ndjson = [
      '{"status":"pulling manifest"}',
      '{"error":"pull model manifest: no such model"}',
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(ndjson, { status: 200 }),
    ));
    await expect(pullModel({ model: "bogus" })).rejects.toBeInstanceOf(InstallError);
  });

  it("tolerates malformed JSON lines in the middle of the stream", async () => {
    const ndjson = [
      '{"status":"a"}',
      'this is garbage',
      '{"status":"b"}',
      '{"status":"success"}',
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(ndjson, { status: 200 }),
    ));
    const progress: string[] = [];
    await pullModel({
      model: "x",
      onProgress: (p) => progress.push(p.status),
    });
    expect(progress).toEqual(["a", "b", "success"]);
  });
});
