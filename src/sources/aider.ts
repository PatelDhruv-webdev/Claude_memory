import { readFile } from "node:fs/promises";
import type { RawEvent } from "../snapshot/types.js";

/**
 * Aider stores its chat history in `.aider.chat.history.md` in the project
 * root, as a markdown file with `# aider chat started at ...` headers and
 * `>` blockquotes for user input. Assistant responses are plain markdown
 * between user blocks.
 *
 * We parse it into the same RawEvent stream the Claude Code adapter
 * produces, so the rest of the pipeline (extract → render) works
 * unchanged.
 */
export async function* parseAiderHistory(path: string): AsyncIterable<RawEvent> {
  const raw = await readFile(path, "utf8");
  for (const ev of toEvents(raw)) yield ev;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
}

export function toEvents(raw: string): RawEvent[] {
  const lines = raw.split(/\r?\n/);
  const turns: Turn[] = [];

  let currentTimestamp: string | undefined;
  let mode: "none" | "user" | "assistant" = "none";
  let buf: string[] = [];

  const flush = () => {
    if (mode === "none" || buf.length === 0) {
      buf = [];
      return;
    }
    const text = buf.join("\n").trim();
    if (text) turns.push({ role: mode, text, timestamp: currentTimestamp });
    buf = [];
  };

  for (const line of lines) {
    // Aider session header: "# aider chat started at 2024-...-..."
    const header = line.match(/^#\s+aider chat started at\s+(.+)$/i);
    if (header) {
      flush();
      currentTimestamp = header[1]!.trim();
      mode = "none";
      continue;
    }

    // User input: blockquote lines start with "> "
    if (line.startsWith("> ")) {
      if (mode !== "user") {
        flush();
        mode = "user";
      }
      buf.push(line.slice(2));
      continue;
    }

    // Aider command/feedback lines (e.g. "Added X to the chat") start with
    // a leading-dash or known markers — treat them as assistant context.
    if (line.startsWith("####")) {
      // "#### " is aider's response delimiter in some versions
      flush();
      mode = "assistant";
      const rest = line.slice(4).trim();
      if (rest) buf.push(rest);
      continue;
    }

    // Blank line ends a user-blockquote section
    if (line.trim() === "") {
      if (mode === "user") {
        flush();
        mode = "none";
      } else if (mode === "assistant") {
        buf.push("");
      }
      continue;
    }

    // Default: append to current mode, opening an assistant block if needed
    if (mode === "none") mode = "assistant";
    buf.push(line);
  }
  flush();

  // Convert turns to RawEvent stream. Each user turn = one user message,
  // each assistant turn = one assistant message. We skip empty turns and
  // strip leading "Tokens:" / "Cost:" footers that aider emits.
  const events: RawEvent[] = [];
  for (const turn of turns) {
    const cleaned = stripAiderFooter(turn.text);
    if (!cleaned) continue;
    events.push({
      type: turn.role,
      timestamp: turn.timestamp,
      message: { role: turn.role, content: cleaned },
    });
  }
  return events;
}

function stripAiderFooter(text: string): string {
  return text
    .replace(/^Tokens:.*$/gm, "")
    .replace(/^Cost:.*$/gm, "")
    .replace(/^Added .+ to the chat\.?$/gm, "")
    .trim();
}
