import { z } from "zod";

export const ConfigSchema = z.object({
  schema_version: z.literal(1),
  mode: z.enum(["local_llm", "external_api", "factual_only"]),
  local_llm: z.object({
    base_url: z.string().url(),
    model: z.string(),
    timeout_seconds: z.number().int().positive(),
  }),
  external_api: z.object({
    base_url: z.string().url(),
    api_key_env: z.string(),
    model: z.string(),
    provider: z.enum(["anthropic", "openai"]),
  }),
  triggers: z.object({
    on_error: z.boolean(),
    on_idle: z.boolean(),
    idle_minutes: z.number().int().positive(),
    on_exit: z.boolean(),
  }),
  snapshot: z.object({
    handoff_filename: z.string(),
    diff_filename: z.string(),
    last_turns: z.number().int().nonnegative(),
    keep_history: z.number().int().nonnegative(),
  }),
  watch: z.object({
    project_root: z.string(),
  }),
  redact: z.object({
    enabled: z.boolean(),
    /** Extra regex patterns merged with the built-in rule set. */
    extra_patterns: z.array(z.object({
      name: z.string(),
      pattern: z.string(),
    })),
  }).default({ enabled: true, extra_patterns: [] }),
  log_level: z.enum(["debug", "info", "warn", "error"]),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  schema_version: 1,
  mode: "local_llm",
  local_llm: {
    base_url: "http://localhost:11434/v1",
    model: "qwen2.5:3b",
    timeout_seconds: 60,
  },
  external_api: {
    base_url: "https://api.anthropic.com",
    api_key_env: "ANTHROPIC_API_KEY",
    model: "claude-haiku-4-5-20251001",
    provider: "anthropic",
  },
  triggers: {
    on_error: true,
    on_idle: true,
    idle_minutes: 5,
    on_exit: true,
  },
  snapshot: {
    handoff_filename: "HANDOFF.md",
    diff_filename: "HANDOFF.diff",
    last_turns: 8,
    keep_history: 10,
  },
  watch: {
    project_root: "auto",
  },
  redact: {
    enabled: true,
    extra_patterns: [],
  },
  log_level: "info",
};
