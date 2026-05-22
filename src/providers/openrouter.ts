import { http } from "./http.js";
import { ProviderError } from "../util/errors.js";
import type { ValidateKeyResult } from "./openai.js";

/**
 * Validates an OpenRouter API key by hitting the /auth/key info endpoint.
 * Returns ok=false on auth failure, ok=true on success, throws on network
 * errors so callers can distinguish "bad key" from "can't reach the API".
 */
export async function validateOpenRouterKey(opts: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<ValidateKeyResult> {
  const key = opts.apiKey.trim();
  if (!key) return { ok: false, status: 0, message: "empty key" };

  const base = (opts.baseUrl ?? "https://openrouter.ai").replace(/\/$/, "");
  try {
    const res = await http({
      url: `${base}/api/v1/auth/key`,
      method: "GET",
      headers: {
        authorization: `Bearer ${key}`,
      },
      timeoutMs: opts.timeoutMs ?? 10_000,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "invalid OpenRouter key" };
    }
    if (res.status === 429) {
      return { ok: true, status: 429, message: "rate-limited but key looks valid" };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: `unexpected HTTP ${res.status}: ${res.body.slice(0, 200)}`,
      };
    }
    return { ok: true, status: res.status, message: "ok" };
  } catch (err) {
    throw new ProviderError(
      `Could not reach OpenRouter: ${(err as Error).message}`,
      "Check your network connection and try again.",
    );
  }
}
