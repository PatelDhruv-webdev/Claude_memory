import { http } from "../providers/http.js";
import { ProviderError } from "../util/errors.js";
import type { Config } from "../config/schema.js";

export interface ChatRequest {
  system: string;
  user: string;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  raw: unknown;
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
  name: string;
}

export function makeClient(config: Config): LlmClient {
  if (config.mode === "local_llm") return makeOllamaClient(config);
  if (config.mode === "external_api") {
    if (config.external_api.provider === "openai") return makeOpenAIClient(config);
    if (config.external_api.provider === "openrouter") return makeOpenRouterClient(config);
    return makeAnthropicClient(config);
  }
  throw new ProviderError(`LLM client requested but mode is "${config.mode}".`);
}

function makeOllamaClient(config: Config): LlmClient {
  const base = config.local_llm.base_url.replace(/\/$/, "");
  const model = config.local_llm.model;
  const defaultTimeout = config.local_llm.timeout_seconds * 1000;
  return {
    name: "ollama",
    async chat(req) {
      const res = await http({
        url: `${base}/chat/completions`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          stream: false,
          max_tokens: req.maxTokens ?? 800,
          temperature: 0.2,
        }),
        timeoutMs: req.timeoutMs ?? defaultTimeout,
      });
      if (!res.ok) {
        throw new ProviderError(`Ollama HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      }
      const json = safeJsonParse(res.body);
      const content = extractChatContent(json);
      return { content, raw: json };
    },
  };
}

function makeOpenAIClient(config: Config): LlmClient {
  const apiKey = process.env[config.external_api.api_key_env];
  if (!apiKey) {
    throw new ProviderError(
      `Env var ${config.external_api.api_key_env} is not set.`,
      `Export ${config.external_api.api_key_env}=... in your shell, then re-run.`,
    );
  }
  const base = config.external_api.base_url.replace(/\/$/, "");
  const model = config.external_api.model;
  return {
    name: "openai",
    async chat(req) {
      const res = await http({
        url: `${base}/v1/chat/completions`,
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          max_tokens: req.maxTokens ?? 800,
          temperature: 0.2,
        }),
        timeoutMs: req.timeoutMs ?? 60_000,
      });
      if (!res.ok) {
        throw new ProviderError(`OpenAI HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      }
      const json = safeJsonParse(res.body);
      return { content: extractChatContent(json), raw: json };
    },
  };
}

function makeAnthropicClient(config: Config): LlmClient {
  const apiKey = process.env[config.external_api.api_key_env];
  if (!apiKey) {
    throw new ProviderError(
      `Env var ${config.external_api.api_key_env} is not set.`,
      `Export ${config.external_api.api_key_env}=... in your shell, then re-run.`,
    );
  }
  const base = config.external_api.base_url.replace(/\/$/, "");
  const model = config.external_api.model;
  return {
    name: "anthropic",
    async chat(req) {
      const res = await http({
        url: `${base}/v1/messages`,
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          system: req.system,
          max_tokens: req.maxTokens ?? 800,
          messages: [{ role: "user", content: req.user }],
        }),
        timeoutMs: req.timeoutMs ?? 60_000,
      });
      if (!res.ok) {
        throw new ProviderError(`Anthropic HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      }
      const json = safeJsonParse(res.body) as
        | { content?: Array<{ type: string; text?: string }> }
        | null;
      const content =
        json?.content
          ?.filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text!)
          .join("") ?? "";
      return { content, raw: json };
    },
  };
}

function makeOpenRouterClient(config: Config): LlmClient {
  const apiKey = process.env[config.external_api.api_key_env];
  if (!apiKey) {
    throw new ProviderError(
      `Env var ${config.external_api.api_key_env} is not set.`,
      `Export ${config.external_api.api_key_env}=... in your shell, then re-run.`,
    );
  }
  const base = config.external_api.base_url.replace(/\/$/, "");
  const model = config.external_api.model;
  return {
    name: "openrouter",
    async chat(req) {
      const res = await http({
        url: `${base}/v1/chat/completions`,
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://github.com/continuum-cli/continuum",
          "x-title": "continuum",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          max_tokens: req.maxTokens ?? 800,
          temperature: 0.2,
        }),
        timeoutMs: req.timeoutMs ?? 60_000,
      });
      if (!res.ok) {
        throw new ProviderError(`OpenRouter HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      }
      const json = safeJsonParse(res.body);
      return { content: extractChatContent(json), raw: json };
    },
  };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractChatContent(json: unknown): string {
  // OpenAI-shape: { choices: [{ message: { content: "..." } }] }
  if (json && typeof json === "object" && "choices" in json) {
    const choices = (json as { choices?: Array<{ message?: { content?: string } }> }).choices;
    return choices?.[0]?.message?.content ?? "";
  }
  return "";
}
