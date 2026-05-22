/**
 * Pattern-based secret redaction. Applied at two boundaries:
 *  1. Before sending session content to the LLM (digest prompt)
 *  2. Before writing HANDOFF.md / HANDOFF.diff to disk
 *
 * The patterns are intentionally conservative — false positives are
 * acceptable (the user sees a [REDACTED-KIND] marker and can investigate),
 * but a leaked secret is not.
 */

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  /** What to replace each match with. {name} is substituted. */
  replacement?: string;
}

export const BUILT_IN_RULES: RedactionRule[] = [
  // Provider API keys (specific formats first so they don't get caught by
  // the generic high-entropy rule)
  { name: "openai_key", pattern: /\bsk-(?!ant-|admin-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "anthropic_key", pattern: /\bsk-ant-(?:api03|admin01)-[A-Za-z0-9_-]{20,}\b/g },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "github_oauth", pattern: /\bgho_[A-Za-z0-9]{36,}\b/g },
  { name: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "aws_secret_key", pattern: /\b(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])\b/g },
  { name: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "slack_token", pattern: /\bxox[abp]-[0-9]+-[0-9]+-[0-9]+-[a-zA-Z0-9]+\b/g },
  { name: "stripe_secret", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "private_key_block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  // env-var-style assignments containing what looks like a secret
  // (lowercased name match + long value)
  { name: "env_secret_assignment", pattern: /\b(?:(?:[A-Z_]+_)?(?:SECRET|TOKEN|API_?KEY|PASSWORD|PASSWD|PRIVATE_?KEY))=([A-Za-z0-9_\-\/+=]{16,})/g, replacement: "[REDACTED-{name}]" },
];

export interface RedactOptions {
  rules?: RedactionRule[];
  /** Extra rules merged with the defaults. */
  extraRules?: RedactionRule[];
}

export interface RedactionStats {
  /** Counts of each rule that fired. */
  counts: Record<string, number>;
  /** Total characters replaced. */
  bytesReplaced: number;
}

export interface RedactResult {
  text: string;
  stats: RedactionStats;
}

/**
 * Apply all rules to `text`. Order matters: more specific rules run first
 * so we don't over-redact (the aws_secret_key rule, in particular, would
 * gobble lots of base64-ish strings if it ran before specific provider
 * patterns).
 */
export function redact(text: string, opts: RedactOptions = {}): RedactResult {
  const rules = [...(opts.rules ?? BUILT_IN_RULES), ...(opts.extraRules ?? [])];
  const counts: Record<string, number> = {};
  let bytesReplaced = 0;
  let result = text;

  for (const rule of rules) {
    const replacement = rule.replacement ?? `[REDACTED-${rule.name}]`;
    result = result.replace(rule.pattern, (match, ...args) => {
      // If the replacement contains {name}, fill it in.
      const filled = replacement.replaceAll("{name}", rule.name);
      counts[rule.name] = (counts[rule.name] ?? 0) + 1;
      bytesReplaced += match.length;
      // For capture-group rules (env_secret_assignment), preserve the
      // KEY= prefix so the result is still readable.
      if (args.length > 1 && typeof args[0] === "string") {
        const captured = args[0];
        const prefix = match.slice(0, match.length - captured.length);
        return prefix + filled;
      }
      return filled;
    });
  }

  return { text: result, stats: { counts, bytesReplaced } };
}

/**
 * Convenience for the common case: redact and return only the text.
 */
export function redactText(text: string, opts: RedactOptions = {}): string {
  return redact(text, opts).text;
}
