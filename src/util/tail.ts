import { open } from "node:fs/promises";

const CHUNK_SIZE = 16 * 1024; // 16 KB per backward read

/**
 * Read the last `n` lines from a file without loading the entire file into
 * memory. Reads backward in CHUNK_SIZE-byte windows until enough lines have
 * been collected or the beginning of the file is reached.
 */
export async function tailLines(filePath: string, n: number): Promise<string[]> {
  if (n <= 0) return [];

  const fd = await open(filePath, "r");
  try {
    const { size } = await fd.stat();
    if (size === 0) return [];

    let collected = "";
    let pos = size;

    while (pos > 0) {
      const readLen = Math.min(CHUNK_SIZE, pos);
      pos -= readLen;
      const buf = Buffer.alloc(readLen);
      await fd.read(buf, 0, readLen, pos);
      collected = buf.toString("utf8") + collected;

      // Stop early once we have buffered more than n+1 newlines
      const newlines = collected.split("\n").length - 1;
      if (newlines > n) break;
    }

    const lines = collected.split("\n");
    // A file ending with "\n" produces a trailing empty string — remove it.
    if (lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-n);
  } finally {
    await fd.close();
  }
}
