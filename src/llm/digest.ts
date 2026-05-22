import type { Config } from "../config/schema.js";
import type { NarrativeSections, SessionState } from "../snapshot/types.js";
import { ProviderError } from "../util/errors.js";
import { withRetry } from "../util/retry.js";
import { makeClient, type LlmClient } from "./client.js";
import { parseNarrative } from "./parse.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

export interface DigestResult {
  narrative: NarrativeSections | null;
  /** If digest failed, why. Useful for logs. */
  error?: string;
}

/**
 * Produces narrative sections from a SessionState. Never throws — on any
 * failure, returns { narrative: null, error }, so the snapshot still ships
 * with placeholders.
 */
export async function digest(
  state: SessionState,
  config: Config,
  client?: LlmClient,
): Promise<DigestResult> {
  if (config.mode === "factual_only") {
    return { narrative: null, error: "mode=factual_only" };
  }

  // Sessions with no substantive content aren't worth a digest call.
  if (
    state.filesTouched.size === 0 &&
    state.commands.length === 0 &&
    state.lastTurns.length === 0
  ) {
    return { narrative: null, error: "empty session" };
  }

  let llm: LlmClient;
  try {
    llm = client ?? makeClient(config);
  } catch (err) {
    return { narrative: null, error: (err as Error).message };
  }

  const userPrompt = buildUserPrompt(state);
  const timeoutMs =
    config.mode === "local_llm" ? config.local_llm.timeout_seconds * 1000 : 60_000;

  try {
    const res = await withRetry(
      () => llm.chat({ system: SYSTEM_PROMPT, user: userPrompt, timeoutMs }),
      {
        retries: 2,
        baseDelayMs: 1_500,
        shouldRetry: (err) => {
          // Don't retry on hard auth errors. Network/5xx → retry.
          const msg = err instanceof Error ? err.message : String(err);
          return !/401|403/.test(msg);
        },
      },
    );
    const narrative = parseNarrative(res.content);
    if (narrative) return { narrative };

    // Repair retry: small local models occasionally wrap JSON in prose or
    // emit extra fields. Ask once more with an explicit reminder. This is
    // cheap and catches the majority of malformed outputs from qwen2.5:3b
    // and similar.
    const repaired = await llm.chat({
      system: SYSTEM_PROMPT,
      user:
        userPrompt +
        "\n\nYour previous response was not valid JSON. Output ONLY the JSON object now — no markdown, no commentary, no code fences.",
      timeoutMs,
    });
    const second = parseNarrative(repaired.content);
    if (second) return { narrative: second };
    return { narrative: null, error: "model returned unparseable output (after repair retry)" };
  } catch (err) {
    return { narrative: null, error: err instanceof ProviderError ? err.message : (err as Error).message };
  }
}
