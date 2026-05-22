import { http } from "./http.js";
import { ProviderError } from "../util/errors.js";
import type { ValidateKeyResult } from "./openai.js";

/**
 * Validates an Anthropic API key with a tiny 1-token messages call.
 * Anthropic doesn't have a /models list endpoint that requires auth,
 * so we use the cheapest possible /v1/messages call.
 */
export async function validateAnthropicKey(opts: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<ValidateKeyResult> {
  const key = opts.apiKey.trim();
  if (!key) return { ok: false, status: 0, message: "empty key" };

  const base = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const model = opts.model ?? "claude-haiku-4-5-20251001";

  try {
    const res = await http({
      url: `${base}/v1/messages`,
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      timeoutMs: opts.timeoutMs ?? 10_000,
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "invalid API key" };
    }
    if (res.status === 429) {
      return { ok: true, status: 429, message: "rate-limited but key looks valid" };
    }
    if (res.status === 404) {
      return { ok: false, status: 404, message: `model "${model}" not found for this key` };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: `unexpected HTTP ${res.status}: ${res.body.slice(0, 200)}` };
    }
    return { ok: true, status: res.status, message: "ok" };
  } catch (err) {
    throw new ProviderError(
      `Could not reach Anthropic: ${(err as Error).message}`,
      "Check your network connection and try again.",
    );
  }
}
