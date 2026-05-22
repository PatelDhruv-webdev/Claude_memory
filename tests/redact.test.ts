import { describe, it, expect } from "vitest";
import { redact, redactText, BUILT_IN_RULES } from "../src/redact/rules.js";
import { redactSessionState } from "../src/redact/apply.js";
import { compileExtraRules } from "../src/redact/config.js";
import type { SessionState } from "../src/snapshot/types.js";

describe("redact built-in rules", () => {
  it("redacts OpenAI keys", () => {
    const r = redact("export OPENAI_API_KEY=sk-proj-abcdef1234567890abcdef1234567890");
    expect(r.text).toContain("[REDACTED-");
    expect(r.text).not.toContain("sk-proj-abcdef1234567890abcdef1234567890");
  });

  it("redacts Anthropic keys", () => {
    const key = "sk-ant-api03-" + "x".repeat(40);
    const r = redact(`key=${key}`);
    expect(r.text).not.toContain(key);
    expect(r.stats.counts.anthropic_key).toBe(1);
  });

  it("redacts GitHub tokens", () => {
    const token = "ghp_" + "a".repeat(36);
    const r = redact(`Authorization: token ${token}`);
    expect(r.text).not.toContain(token);
    expect(r.stats.counts.github_token).toBe(1);
  });

  it("redacts AWS access keys", () => {
    const r = redact("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(r.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.stats.counts.aws_access_key).toBe(1);
  });

  it("redacts JWTs", () => {
    const jwt = "eyJabcdefghij.eyJklmnopqrst.uvwxyz1234567890";
    const r = redact(`Bearer ${jwt}`);
    expect(r.text).not.toContain(jwt);
  });

  it("redacts private key PEM blocks", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA...",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const r = redact(pem);
    expect(r.text).not.toContain("MIIEow");
    expect(r.stats.counts.private_key_block).toBe(1);
  });

  it("redacts env-var-style secret assignments while keeping the KEY visible", () => {
    const r = redact("DATABASE_PASSWORD=hunter2-very-long-secret-string");
    expect(r.text).toContain("DATABASE_PASSWORD=");
    expect(r.text).not.toContain("hunter2-very-long-secret-string");
  });

  it("does not over-redact normal prose", () => {
    const text = "The rate of progress is good. Hello world.";
    const r = redact(text);
    expect(r.text).toBe(text);
    expect(r.stats.bytesReplaced).toBe(0);
  });

  it("redacts multiple secrets in the same text and counts them all", () => {
    const t = "sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaa AKIAIOSFODNN7EXAMPLE";
    const r = redact(t);
    expect(r.stats.counts.openai_key).toBe(1);
    expect(r.stats.counts.aws_access_key).toBe(1);
  });

  it("accepts extra user rules", () => {
    const extra = [{ name: "internal_id", pattern: /\bINT-[0-9]{6}\b/g }];
    const r = redact("ticket INT-123456 is open", { extraRules: extra });
    expect(r.text).toContain("[REDACTED-internal_id]");
  });

  it("redactText returns just the string", () => {
    expect(redactText("hello sk-proj-abcdefghijklmnopqrstuv")).toContain("[REDACTED-");
  });

  it("BUILT_IN_RULES is non-empty and stable", () => {
    expect(BUILT_IN_RULES.length).toBeGreaterThan(5);
    expect(BUILT_IN_RULES.every((r) => r.name && r.pattern instanceof RegExp)).toBe(true);
  });
});

describe("redactSessionState", () => {
  function state(): SessionState {
    return {
      goal: "Use the API with sk-proj-abcdefghijklmnopqrstuvwx",
      filesTouched: new Map([["/x.ts", { path: "/x.ts", reads: 1, edits: 0, writes: 0 }]]),
      commands: [
        {
          command: "curl -H 'Authorization: Bearer ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' https://api",
          output: "401 unauthorized",
        },
      ],
      errors: [{ toolName: "Bash", message: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE leaked" }],
      tokenUsage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      stopReason: "end_turn",
      lastTurns: [{ role: "user", text: "my key is sk-proj-zzzzzzzzzzzzzzzzzzzzzzzz" }],
    };
  }

  it("redacts goal, commands, command output, errors, and turn text", () => {
    const { state: s, stats } = redactSessionState(state());
    expect(s.goal).not.toContain("sk-proj-");
    expect(s.commands[0]!.command).not.toContain("ghp_");
    expect(s.errors[0]!.message).not.toContain("AKIA");
    expect(s.lastTurns[0]!.text).not.toContain("sk-proj-");
    expect(stats.bytesReplaced).toBeGreaterThan(0);
  });

  it("preserves filesTouched and token usage untouched", () => {
    const original = state();
    const { state: s } = redactSessionState(original);
    expect(s.filesTouched).toBe(original.filesTouched);
    expect(s.tokenUsage).toEqual(original.tokenUsage);
  });
});

describe("compileExtraRules", () => {
  it("compiles valid patterns", () => {
    const rules = compileExtraRules([{ name: "x", pattern: "FOO-[0-9]+" }]);
    expect(rules.length).toBe(1);
    expect(rules[0]!.pattern.test("FOO-123")).toBe(true);
  });

  it("skips invalid regexes without throwing", () => {
    const rules = compileExtraRules([
      { name: "bad", pattern: "[unbalanced" },
      { name: "good", pattern: "OK" },
    ]);
    expect(rules.length).toBe(1);
    expect(rules[0]!.name).toBe("good");
  });
});
