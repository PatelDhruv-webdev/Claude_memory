import type { NarrativeSections } from "../snapshot/types.js";

/**
 * Tolerant parser for LLM JSON output. The model occasionally wraps JSON in
 * markdown fences or prepends commentary — strip those, then extract the
 * first balanced JSON object. Missing keys become empty strings.
 *
 * Returns null when no valid JSON object can be recovered, so callers can
 * fall back to placeholders.
 */
export function parseNarrative(raw: string): NarrativeSections | null {
  const candidate = extractFirstJsonObject(stripCodeFences(raw));
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  return {
    what_we_did: stringOf(obj.what_we_did),
    decisions_made: stringOf(obj.decisions_made),
    rejected_approaches: stringOf(obj.rejected_approaches),
  };
}

function stringOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    return v
      .filter((x) => typeof x === "string")
      .map((x) => (x as string).startsWith("- ") ? x : `- ${x}`)
      .join("\n");
  }
  return "";
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    // Strip first line (```json) and last fence
    const lines = trimmed.split("\n");
    if (lines.length >= 2) {
      const inner = lines.slice(1, lines[lines.length - 1]!.startsWith("```") ? -1 : undefined);
      return inner.join("\n");
    }
  }
  return raw;
}

function extractFirstJsonObject(text: string): string | null {
  // Find the first '{' that has a balanced '}' downstream, respecting strings.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
