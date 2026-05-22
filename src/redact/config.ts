import type { RedactionRule } from "./rules.js";

/**
 * Compile user-supplied extra patterns from config (where they're stored as
 * strings, since YAML can't carry RegExp). Bad regexes are skipped with a
 * warning to stderr rather than crashing the snapshot.
 */
export function compileExtraRules(
  raw: Array<{ name: string; pattern: string }>,
): RedactionRule[] {
  const rules: RedactionRule[] = [];
  for (const r of raw) {
    try {
      rules.push({ name: r.name, pattern: new RegExp(r.pattern, "g") });
    } catch (err) {
      process.stderr.write(
        `continuum: skipping invalid extra redaction pattern "${r.name}": ${(err as Error).message}\n`,
      );
    }
  }
  return rules;
}
