import { readFile } from "node:fs/promises";
import type { RawEvent } from "../snapshot/types.js";

/**
 * Generic markdown transcript parser. Recognizes turns marked with H1/H2
 * headings, blockquote-style chat, or bold role labels. Designed to be
 * forgiving: anything between role markers becomes that role's content.
 *
 * Recognized role markers (case-insensitive):
 *   # User / # Assistant / # System
 *   ## User: / ## Assistant:
 *   **User:** / **Assistant:**
 *
 * Anything before the first role marker is treated as the goal (a
 * synthetic first-user-message).
 */
export async function* parseMarkdownTranscript(path: string): AsyncIterable<RawEvent> {
  const raw = await readFile(path, "utf8");
  for (const ev of toEvents(raw)) yield ev;
}

const ROLE_HEADING = /^(?:#{1,6}\s+|\*\*)\s*(user|assistant|system)\s*[:.]?\s*\*?\*?\s*$/i;

export function toEvents(raw: string): RawEvent[] {
  const lines = raw.split(/\r?\n/);
  const events: RawEvent[] = [];

  let currentRole: "user" | "assistant" | "system" | null = null;
  let buf: string[] = [];
  let preamble: string[] = [];

  const flush = () => {
    if (currentRole === null) return;
    const text = buf.join("\n").trim();
    if (text) {
      events.push({
        type: currentRole === "system" ? "user" : currentRole,
        message: { role: currentRole, content: text },
      });
    }
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(ROLE_HEADING);
    if (m) {
      flush();
      currentRole = m[1]!.toLowerCase() as "user" | "assistant" | "system";
      continue;
    }
    if (currentRole === null) {
      preamble.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();

  // If we collected a non-empty preamble and there's no explicit goal,
  // inject it as the first user message so extract() can pick it up.
  const pre = preamble.join("\n").trim();
  if (pre && (events.length === 0 || events[0]!.message?.role !== "user")) {
    events.unshift({ type: "user", message: { role: "user", content: pre } });
  }

  return events;
}
