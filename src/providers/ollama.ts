import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { http, httpStream } from "./http.js";
import { InstallError } from "../util/errors.js";
import { withRetry, sleep } from "../util/retry.js";

const exec = promisify(execFile);

const DEFAULT_HOST = "http://localhost:11434";

export interface OllamaEnv {
  host?: string;
  // Injectable for tests:
  runCommand?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  fetchImpl?: typeof fetch;
  whichImpl?: (bin: string) => Promise<string | null>;
}

/** Returns true if the Ollama HTTP API is reachable. */
export async function isOllamaRunning(env: OllamaEnv = {}): Promise<boolean> {
  const host = env.host ?? DEFAULT_HOST;
  try {
    const res = await http({ url: `${host}/api/version`, timeoutMs: 2_000 });
    return res.ok;
  } catch {
    return false;
  }
}

/** Returns true if the `ollama` binary exists on PATH. */
export async function isOllamaInstalled(env: OllamaEnv = {}): Promise<boolean> {
  const which = env.whichImpl ?? defaultWhich;
  return (await which("ollama")) !== null;
}

async function defaultWhich(bin: string): Promise<string | null> {
  try {
    const cmd = platform() === "win32" ? "where" : "which";
    const { stdout } = await exec(cmd, [bin]);
    const first = stdout.split(/\r?\n/).find((s) => s.trim().length > 0);
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

/** Best-effort start of the Ollama service. Returns true if it becomes reachable. */
export async function startOllama(env: OllamaEnv = {}): Promise<boolean> {
  if (await isOllamaRunning(env)) return true;
  // Spawn detached so it survives this process.
  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Poll for up to 10s.
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await isOllamaRunning(env)) return true;
  }
  return false;
}

/**
 * Run the platform-appropriate installer for Ollama.
 * On macOS/Linux: `curl -fsSL https://ollama.com/install.sh | sh`.
 * On Windows: download and run the silent installer.
 *
 * Streams installer stdout/stderr to onLog so the caller can render progress.
 */
export async function installOllama(opts: {
  onLog?: (line: string) => void;
  env?: OllamaEnv;
}): Promise<void> {
  const onLog = opts.onLog ?? (() => undefined);
  const os = platform();

  if (os === "win32") {
    throw new InstallError(
      "Automatic Ollama install on Windows is not yet implemented in this build.",
      "Install manually from https://ollama.com/download, then re-run `continuum reinstall`.",
    );
  }

  // Verify curl exists; otherwise we can't run the install pipeline.
  const which = opts.env?.whichImpl ?? defaultWhich;
  const curl = await which("curl");
  const sh = await which("sh");
  if (!curl || !sh) {
    throw new InstallError(
      "`curl` and `sh` are required for the Ollama installer.",
      "Install them via your package manager, or install Ollama manually from https://ollama.com.",
    );
  }

  await withRetry(
    () =>
      new Promise<void>((resolve, reject) => {
        // We use `sh -c "curl ... | sh"` so we can stream from one process.
        const child = spawn("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => chunk.split(/\r?\n/).forEach((l) => l && onLog(l)));
        child.stderr.on("data", (chunk: string) => chunk.split(/\r?\n/).forEach((l) => l && onLog(l)));
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new InstallError(`Ollama installer exited with code ${code}.`));
        });
      }),
    {
      retries: 2,
      baseDelayMs: 2_000,
      shouldRetry: (err) =>
        // Retry on network-ish failures; don't retry installer-script failures
        // (those usually need user intervention, e.g. sudo prompt).
        err instanceof InstallError ? false : true,
      onRetry: (_err, attempt, delay) =>
        onLog(`installer attempt ${attempt + 1} failed, retrying in ${delay}ms…`),
    },
  );
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/**
 * Pull a model via the Ollama HTTP API. Streams NDJSON progress events.
 *
 * Idempotent: re-issuing on a partial download resumes from where it left off.
 */
export async function pullModel(opts: {
  model: string;
  host?: string;
  onProgress?: (p: PullProgress) => void;
  timeoutMs?: number;
}): Promise<void> {
  const host = opts.host ?? DEFAULT_HOST;
  const onProgress = opts.onProgress ?? (() => undefined);

  const res = await httpStream({
    url: `${host}/api/pull`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: opts.model, stream: true }),
    timeoutMs: opts.timeoutMs ?? 10 * 60_000,
  });

  if (!res.ok || !res.body) {
    throw new InstallError(
      `Failed to pull model "${opts.model}" (HTTP ${res.status}).`,
      `Check that Ollama is running at ${host} and the model name is valid.`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const handleLine = (line: string): void => {
    if (!line.trim()) return;
    let evt: PullProgress & { error?: string };
    try {
      evt = JSON.parse(line) as PullProgress & { error?: string };
    } catch {
      // Bad JSON in stream — skip silently, the next event usually recovers.
      return;
    }
    if (evt.error) {
      throw new InstallError(
        `Model pull failed: ${evt.error}`,
        `Try \`ollama pull ${opts.model}\` manually, then re-run \`continuum reinstall\`.`,
      );
    }
    onProgress(evt);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  // Flush any final line that wasn't newline-terminated.
  buf += decoder.decode();
  if (buf.length > 0) handleLine(buf);
}
