import type { Config } from "../config/schema.js";
import { defaultConfig, saveConfig } from "../config/io.js";
import {
  installOllama,
  isOllamaInstalled,
  isOllamaRunning,
  pullModel,
  startOllama,
} from "../providers/ollama.js";
import { validateOpenAIKey } from "../providers/openai.js";
import { validateAnthropicKey } from "../providers/anthropic.js";
import type { Prompter } from "./prompt.js";
import { isInteractive, makeReadlinePrompter } from "./prompt.js";
import { ConfigError, InstallError, ProviderError, formatError } from "../util/errors.js";

const OPTIONS = [
  "Free local LLM   — Ollama + qwen2.5:3b  (~2.6 GB download, runs offline)",
  "OpenAI API       — paste your key, uses gpt-4o-mini by default",
  "Anthropic API    — paste your key, uses claude-haiku-4-5 by default",
  "Skip — factual only, no LLM",
] as const;

export interface RunPickerOptions {
  prompter?: Prompter;
  /** Suppress interactive prompts. Used in CI / piped contexts. */
  nonInteractive?: boolean;
  /** Override the default choice when --mode flag is passed. */
  forcedMode?: "local_llm" | "openai" | "anthropic" | "factual_only";
  /** Write target. Defaults to ~/.continuum/config.yml. */
  configPath?: string;
  out?: NodeJS.WritableStream;
}

export async function runFirstRunPicker(opts: RunPickerOptions = {}): Promise<Config> {
  const out = opts.out ?? process.stdout;
  const nonInteractive = opts.nonInteractive ?? !isInteractive();
  const prompter = opts.prompter ?? (nonInteractive ? null : makeReadlinePrompter());

  const config = defaultConfig();

  out.write("Welcome to continuum.\n\n");
  out.write("continuum can use a local LLM, an API provider, or skip LLM entirely.\n\n");

  let choiceIdx: number;
  if (opts.forcedMode) {
    choiceIdx = forcedToIdx(opts.forcedMode);
  } else if (!prompter) {
    out.write("Non-interactive environment detected — defaulting to factual_only mode.\n");
    out.write("Re-run `continuum reinstall` in a terminal to set up an LLM provider.\n");
    choiceIdx = 3;
  } else {
    choiceIdx = await prompter.askChoice(
      "Choose how you want narrative summaries generated:",
      [...OPTIONS],
      0,
    );
  }

  try {
    switch (choiceIdx) {
      case 0:
        await setupOllama(config, out);
        break;
      case 1:
        await setupOpenAI(config, prompter, out);
        break;
      case 2:
        await setupAnthropic(config, prompter, out);
        break;
      case 3:
      default:
        config.mode = "factual_only";
        out.write("Skipping LLM setup. Narrative sections will show as not-generated.\n");
        break;
    }
  } finally {
    prompter?.close();
  }

  await saveConfig(config, opts.configPath);
  out.write(`\nWrote config to ${opts.configPath ?? "~/.continuum/config.yml"}.\n`);
  out.write("✓ Ready. Run `continuum` in any project to start watching.\n");
  return config;
}

function forcedToIdx(mode: NonNullable<RunPickerOptions["forcedMode"]>): number {
  switch (mode) {
    case "local_llm": return 0;
    case "openai": return 1;
    case "anthropic": return 2;
    case "factual_only": return 3;
  }
}

async function setupOllama(config: Config, out: NodeJS.WritableStream): Promise<void> {
  config.mode = "local_llm";

  if (await isOllamaRunning()) {
    out.write("✓ Ollama already running.\n");
  } else if (await isOllamaInstalled()) {
    out.write("Starting Ollama service…\n");
    const started = await startOllama();
    if (!started) {
      out.write("Could not start Ollama automatically. Run `ollama serve` manually, then re-run.\n");
      throw new InstallError("Ollama is installed but not reachable.");
    }
  } else {
    out.write("Installing Ollama (this may take a minute)…\n");
    await installOllama({
      onLog: (line) => out.write(`  [ollama-install] ${line}\n`),
    });
    out.write("Starting Ollama service…\n");
    await startOllama();
  }

  out.write(`Pulling model "${config.local_llm.model}" (this can be a few GB)…\n`);
  let lastPct = -1;
  await pullModel({
    model: config.local_llm.model,
    host: config.local_llm.base_url.replace(/\/v1$/, ""),
    onProgress: (p) => {
      if (p.total && p.completed) {
        const pct = Math.floor((p.completed / p.total) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
          out.write(`  ${p.status}: ${pct}%\n`);
          lastPct = pct;
        }
      } else if (p.status) {
        out.write(`  ${p.status}\n`);
      }
    },
  });
  out.write("✓ Model ready.\n");
}

async function setupOpenAI(
  config: Config,
  prompter: Prompter | null,
  out: NodeJS.WritableStream,
): Promise<void> {
  config.mode = "external_api";
  config.external_api.provider = "openai";
  config.external_api.base_url = "https://api.openai.com";
  config.external_api.api_key_env = "OPENAI_API_KEY";
  config.external_api.model = "gpt-4o-mini";

  if (!prompter) {
    out.write("Non-interactive: skipping key validation. Set OPENAI_API_KEY before running.\n");
    return;
  }

  await validateKeyLoop(prompter, out, async (key) => {
    const r = await validateOpenAIKey({ apiKey: key });
    return r;
  });
  out.write("✓ OpenAI key valid. Set OPENAI_API_KEY in your shell before running `continuum`.\n");
}

async function setupAnthropic(
  config: Config,
  prompter: Prompter | null,
  out: NodeJS.WritableStream,
): Promise<void> {
  config.mode = "external_api";
  config.external_api.provider = "anthropic";
  config.external_api.base_url = "https://api.anthropic.com";
  config.external_api.api_key_env = "ANTHROPIC_API_KEY";
  config.external_api.model = "claude-haiku-4-5-20251001";

  if (!prompter) {
    out.write("Non-interactive: skipping key validation. Set ANTHROPIC_API_KEY before running.\n");
    return;
  }

  await validateKeyLoop(prompter, out, async (key) => {
    const r = await validateAnthropicKey({ apiKey: key });
    return r;
  });
  out.write("✓ Anthropic key valid. Set ANTHROPIC_API_KEY in your shell before running `continuum`.\n");
}

async function validateKeyLoop(
  prompter: Prompter,
  out: NodeJS.WritableStream,
  validate: (key: string) => Promise<{ ok: boolean; message: string }>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = (await prompter.askSecret("Paste API key (will not echo): ")).trim();
    if (!key) {
      out.write("Empty key. Try again.\n");
      continue;
    }
    try {
      const r = await validate(key);
      if (r.ok) return;
      out.write(`✗ ${r.message}\n`);
    } catch (err) {
      out.write(`✗ ${formatError(err)}\n`);
      if (err instanceof ProviderError) {
        const retry = await prompter.askYesNo("Retry?", true);
        if (!retry) throw new ConfigError("Onboarding cancelled by user.");
      }
    }
  }
  throw new ConfigError("Could not validate API key after 3 attempts.");
}
