import { http } from "./http.js";
import { ProviderError } from "../util/errors.js";

export interface ValidateKeyResult {
  ok: boolean;
  status: number;
  message: string;
}

/**
 * Lightly validates an OpenAI key by listing models (a cheap, idempotent call).
 * Returns ok=false on auth failure, ok=true on success, throws only on
 * unexpected errors (network, etc.) so callers can distinguish "bad key"
 * from "can't reach the API".
 */
export async function validateOpenAIKey(opts: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<ValidateKeyResult> {
  const key = opts.apiKey.trim();
  if (!key) return { ok: false, status: 0, message: "empty key" };

  const base = (opts.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  try {
    const res = await http({
      url: `${base}/v1/models`,
      headers: { authorization: `Bearer ${key}` },
      timeoutMs: opts.timeoutMs ?? 10_000,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "invalid API key" };
    }
    if (res.status === 429) {
      // Auth succeeded but we're rate-limited — key is probably valid.
      return { ok: true, status: 429, message: "rate-limited but key looks valid" };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: `unexpected HTTP ${res.status}: ${res.body.slice(0, 200)}` };
    }
    return { ok: true, status: res.status, message: "ok" };
  } catch (err) {
    throw new ProviderError(
      `Could not reach OpenAI: ${(err as Error).message}`,
      "Check your network connection and try again.",
    );
  }
}
