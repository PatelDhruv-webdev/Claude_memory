import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseSessionFile } from "../src/snapshot/parse.js";

const FIXTURES = join(__dirname, "fixtures");

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("parseSessionFile", () => {
  it("parses well-formed JSONL and skips meta events", async () => {
    const events = await collect(
      parseSessionFile(join(FIXTURES, "session-clean-end.jsonl")),
    );
    expect(events.length).toBe(6);
    expect(events.every((e) => e.isMeta !== true)).toBe(true);
  });

  it("skips malformed lines silently and filters meta events", async () => {
    const events = await collect(
      parseSessionFile(join(FIXTURES, "session-with-errors.jsonl")),
    );
    // 8 lines total, 1 meta + 1 malformed dropped = 6
    expect(events.length).toBe(6);
    expect(events.find((e) => e.isMeta === true)).toBeUndefined();
  });
});
