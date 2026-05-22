import { writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Atomically write a file: write to a sibling tempfile, fsync semantics via
 * rename(2) which is atomic on POSIX. Leaves no partial file on crash.
 *
 * The parent directory is created (recursive) if it doesn't exist.
 */
export async function writeFileAtomic(
  path: string,
  content: string | Uint8Array,
  encoding: BufferEncoding = "utf8",
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    if (typeof content === "string") {
      await writeFile(tmp, content, encoding);
    } else {
      await writeFile(tmp, content);
    }
    await rename(tmp, path);
  } catch (err) {
    // Best-effort cleanup of the temp file
    try {
      await unlink(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}
