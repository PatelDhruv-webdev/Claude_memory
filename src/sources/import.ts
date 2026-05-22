import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { RawEvent } from "../snapshot/types.js";
import { parseSessionFile } from "../snapshot/parse.js";
import { parseAiderHistory } from "./aider.js";
import { parseMarkdownTranscript } from "./markdown.js";

export type ImportKind = "auto" | "claude-code" | "aider" | "markdown" | "jsonl";

export interface ImportOptions {
  kind: ImportKind;
  path: string;
}

export async function detectKind(path: string): Promise<Exclude<ImportKind, "auto">> {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  const ext = extname(path).toLowerCase();
  if (ext === ".jsonl") return "claude-code";

  // Aider's well-known filename
  if (path.endsWith(".aider.chat.history.md")) return "aider";

  // Probe the first 4KB
  const head = (await readFile(path, "utf8")).slice(0, 4096);
  if (/^#\s+aider chat started at/im.test(head)) return "aider";
  if (head.trim().startsWith("{") && head.includes('"type"')) return "jsonl";
  if (/^(#{1,6}\s+(user|assistant)|^\*\*(user|assistant))/im.test(head)) return "markdown";

  return "markdown"; // safe-ish default for unknown markdown-y files
}

export async function* importSession(opts: ImportOptions): AsyncIterable<RawEvent> {
  const kind = opts.kind === "auto" ? await detectKind(opts.path) : opts.kind;
  switch (kind) {
    case "claude-code":
    case "jsonl":
      yield* parseSessionFile(opts.path);
      return;
    case "aider":
      yield* parseAiderHistory(opts.path);
      return;
    case "markdown":
      yield* parseMarkdownTranscript(opts.path);
      return;
  }
}
