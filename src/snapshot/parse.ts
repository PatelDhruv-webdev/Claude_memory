import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { RawEventSchema, type RawEvent } from "./types.js";

export async function* parseSessionFile(
  path: string,
): AsyncIterable<RawEvent> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      // Truncated trailing line or partial write — drop silently.
      continue;
    }

    const parsed = RawEventSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (parsed.data.isMeta === true) continue;

    yield parsed.data;
  }
}
