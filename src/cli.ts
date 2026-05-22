import { Command } from "commander";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { snapshot } from "./snapshot/index.js";
import { extractState } from "./snapshot/extract.js";
import { claudeCodeSource } from "./sources/claude-code.js";
import { digest } from "./llm/digest.js";
import { loadConfig, saveConfig, defaultConfig } from "./config/io.js";
import { configPath, logPath } from "./util/paths.js";
import { runFirstRunPicker } from "./onboarding/picker.js";
import { spawnDaemon, stopDaemon, statusDaemon } from "./daemon/lifecycle.js";
import { runDaemon } from "./daemon/runner.js";
import { formatError } from "./util/errors.js";
import { buildResume, type ResumeTarget } from "./resume/build.js";
import { copyToClipboard } from "./resume/clipboard.js";
import { runDoctor, formatChecks, worstStatus } from "./doctor/run.js";
import { importSession, type ImportKind } from "./sources/import.js";
import { getGitInfo } from "./snapshot/git.js";
import { render } from "./snapshot/render.js";
import { writeFileAtomic } from "./util/atomic.js";
import { rotateHandoff } from "./snapshot/history.js";
import { redactSessionState } from "./redact/apply.js";
import { redactText } from "./redact/rules.js";
import { compileExtraRules } from "./redact/config.js";
import { runInit } from "./init/run.js";
import { join } from "node:path";
import {
  installOllama,
  isOllamaInstalled,
  isOllamaRunning,
  pullModel,
  startOllama,
} from "./providers/ollama.js";

const program = new Command();

program
  .name("continuum")
  .description(
    "Automatic session-handoff daemon for AI coding agents. " +
      "Watches your Claude Code session and produces HANDOFF.md when it ends.",
  )
  .version("0.1.0");

program
  .command("snapshot")
  .description("Produce HANDOFF.md and HANDOFF.diff for the current project now")
  .option("--no-llm", "Skip LLM digest even if configured")
  .action(async (opts: { llm: boolean }) => {
    try {
      const config = (await loadConfig()) ?? defaultConfig();
      let narrative = null;
      if (opts.llm !== false && config.mode !== "factual_only") {
        const file = await claudeCodeSource.discover(process.cwd());
        if (file) {
          const state = await extractState(claudeCodeSource.parse(file), {
            lastTurns: config.snapshot.last_turns,
          });
          const dig = await digest(state, config);
          narrative = dig.narrative;
          if (dig.error) console.error(`(digest skipped: ${dig.error})`);
        }
      }
      const result = await snapshot({
        cwd: process.cwd(),
        config,
        narrative,
      });
      console.log(`✓ Wrote ${result.handoffPath}`);
      console.log(`✓ Wrote ${result.diffPath}`);
      console.log(`  Source: ${result.sourceFile}`);
    } catch (err) {
      console.error(`✗ ${formatError(err)}`);
      process.exit(1);
    }
  });

program
  .command("start")
  .description("Start the watcher daemon for the current project")
  .action(async () => {
    try {
      const config = await loadConfig();
      if (!config) {
        console.error("No config yet. Run `continuum reinstall` first.");
        process.exit(2);
      }
      const rec = await spawnDaemon(process.cwd());
      console.log(`✓ Daemon started (PID ${rec.pid}, project ${rec.projectRoot}).`);
      console.log(`  Logs: ${logPath()}`);
    } catch (err) {
      console.error(`✗ ${formatError(err)}`);
      process.exit(1);
    }
  });

program
  .command("stop")
  .description("Stop the watcher daemon")
  .action(async () => {
    try {
      const r = await stopDaemon();
      if (r.stopped) console.log(`✓ Stopped daemon (PID ${r.pid}).`);
      else console.log("No daemon running.");
    } catch (err) {
      console.error(`✗ ${formatError(err)}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show daemon status")
  .action(async () => {
    const s = await statusDaemon();
    if (!s.running) {
      console.log("continuum: not running");
      return;
    }
    console.log(`continuum: running`);
    console.log(`  PID:        ${s.record!.pid}`);
    console.log(`  Project:    ${s.record!.projectRoot}`);
    console.log(`  Started:    ${s.record!.startedAt}`);
    console.log(`  Log:        ${logPath()}`);
  });

program
  .command("logs")
  .description("Print the daemon log (tail by default; pass --all for full)")
  .option("--all", "Print the entire log")
  .option("-n, --lines <n>", "Number of lines to print", "100")
  .action(async (opts: { all: boolean; lines: string }) => {
    const path = logPath();
    if (!existsSync(path)) {
      console.log("No log yet.");
      return;
    }
    const lines = Number.parseInt(opts.lines, 10);
    if (opts.all) {
      const stream = createReadStream(path, { encoding: "utf8" });
      stream.pipe(process.stdout);
      return;
    }
    // Read last N lines from the tail. Cheap implementation: read whole file
    // (log rotation keeps it bounded). For very large logs this is fine
    // until the next phase.
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(path, "utf8");
    const all = content.split("\n");
    const tail = all.slice(-lines).join("\n");
    process.stdout.write(tail);
    if (!tail.endsWith("\n")) process.stdout.write("\n");
    await stat(path); // touch to confirm
  });

program
  .command("config")
  .description("Open the config file in $EDITOR")
  .action(async () => {
    const path = configPath();
    if (!existsSync(path)) {
      console.error(`No config at ${path}. Run \`continuum reinstall\` first.`);
      process.exit(2);
    }
    const editor =
      process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
    const child = spawn(editor, [path], { stdio: "inherit" });
    child.on("close", (code) => process.exit(code ?? 0));
  });

program
  .command("resume")
  .description("Print a primer for pasting into the next AI agent (reads HANDOFF.md)")
  .option(
    "--to <target>",
    "Target agent format: claude | codex | cursor | aider | generic",
    "generic",
  )
  .option("--no-diff", "Don't include HANDOFF.diff in the primer")
  .option("--copy", "Copy to clipboard instead of printing")
  .action(async (opts: { to: string; diff: boolean; copy?: boolean }) => {
    try {
      const config = (await loadConfig()) ?? defaultConfig();
      const valid: ResumeTarget[] = ["claude", "codex", "cursor", "aider", "generic"];
      if (!(valid as string[]).includes(opts.to)) {
        console.error(`✗ Unknown --to target "${opts.to}". Valid: ${valid.join(", ")}`);
        process.exit(2);
      }
      const result = await buildResume({
        projectRoot: process.cwd(),
        target: opts.to as ResumeTarget,
        handoffFilename: config.snapshot.handoff_filename,
        diffFilename: config.snapshot.diff_filename,
        includeDiff: opts.diff !== false,
      });
      if (opts.copy) {
        const clip = await copyToClipboard(result.text);
        if (clip.ok) {
          console.error(`✓ Copied ${result.bytes} bytes to clipboard via ${clip.tool}.`);
        } else {
          console.error(`✗ Clipboard unavailable (${clip.error}). Printing instead.`);
          process.stdout.write(result.text);
        }
      } else {
        process.stdout.write(result.text);
      }
    } catch (err) {
      console.error(`✗ ${formatError(err)}`);
      process.exit(1);
    }
  });

program
  .command("import <file>")
  .description("Import a session transcript from another agent (aider, markdown, jsonl)")
  .option("--from <kind>", "Source format: auto|claude-code|aider|markdown|jsonl", "auto")
  .option("--out <dir>", "Where to write HANDOFF.md (defaults to current dir)")
  .option("--no-llm", "Skip the LLM digest")
  .action(async (file: string, opts: { from: string; out?: string; llm: boolean }) => {
    try {
      const kinds: ImportKind[] = ["auto", "claude-code", "aider", "markdown", "jsonl"];
      if (!(kinds as string[]).includes(opts.from)) {
        console.error(`✗ Unknown --from "${opts.from}". Valid: ${kinds.join(", ")}`);
        process.exit(2);
      }
      const config = (await loadConfig()) ?? defaultConfig();
      const events = importSession({ kind: opts.from as ImportKind, path: file });

      const rawState = await extractState(events, { lastTurns: config.snapshot.last_turns });
      const extraRules = compileExtraRules(config.redact.extra_patterns);
      const state = config.redact.enabled
        ? redactSessionState(rawState, { extraRules }).state
        : rawState;

      let narrative = null;
      if (opts.llm !== false && config.mode !== "factual_only") {
        const d = await digest(state, config);
        narrative = d.narrative;
        if (d.error) console.error(`(digest skipped: ${d.error})`);
      }

      const outDir = opts.out ?? process.cwd();
      const git = await getGitInfo(outDir);
      const md = render(state, git, narrative, {
        generatedAt: new Date().toISOString(),
        projectPath: outDir,
        sourceFile: file,
        lastTurnsCount: config.snapshot.last_turns,
      });

      const handoffPath = join(outDir, config.snapshot.handoff_filename);
      const diffPath = join(outDir, config.snapshot.diff_filename);
      await rotateHandoff(outDir, handoffPath, config.snapshot.keep_history);
      const diffBody = config.redact.enabled ? redactText(git.diff, { extraRules }) : git.diff;
      await writeFileAtomic(handoffPath, md);
      await writeFileAtomic(diffPath, diffBody);
      console.log(`✓ Wrote ${handoffPath}`);
      console.log(`✓ Wrote ${diffPath}`);
      console.log(`  Source: ${file}`);
    } catch (err) {
      console.error(`✗ ${formatError(err)}`);
      process.exit(1);
    }
  });

program
  .command("init")
  .description("Set up the current project for continuum (gitignore + optional config)")
  .option("--with-config", "Also write a project-local .continuum/config.yml stub")
  .action(async (opts: { withConfig?: boolean }) => {
    try {
      const config = (await loadConfig()) ?? defaultConfig();
      const r = await runInit({
        cwd: process.cwd(),
        withProjectConfig: opts.withConfig === true,
        handoffFilename: config.snapshot.handoff_filename,
        diffFilename: config.snapshot.diff_filename,
      });
      for (const step of r.steps) {
        const mark = step.status === "done" ? "✓" : "·";
        console.log(`${mark} ${step.name}: ${step.detail ?? step.status}`);
      }
    } catch (err) {
      console.error(`✗ ${formatError(err)}`);
      process.exit(1);
    }
  });

program
  .command("redact [file]")
  .description("Redact secrets from a file (or stdin if no file given); prints to stdout")
  .option("--stats", "Print a stats summary to stderr")
  .action(async (file: string | undefined, opts: { stats?: boolean }) => {
    try {
      const { redact } = await import("./redact/rules.js");
      const config = (await loadConfig()) ?? defaultConfig();
      const extraRules = compileExtraRules(config.redact.extra_patterns);

      const { readFile: rf } = await import("node:fs/promises");
      const input = file ? await rf(file, "utf8") : await readStdin();
      const r = redact(input, { extraRules });
      process.stdout.write(r.text);
      if (opts.stats) {
        const total = Object.values(r.stats.counts).reduce((a, b) => a + b, 0);
        process.stderr.write(
          `\ncontinuum: redacted ${total} secret(s), ${r.stats.bytesReplaced} bytes: ` +
            JSON.stringify(r.stats.counts) +
            "\n",
        );
      }
    } catch (err) {
      console.error(`✗ ${formatError(err)}`);
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Diagnostic checks: config, Ollama, session, daemon, log")
  .action(async () => {
    const checks = await runDoctor({ cwd: process.cwd() });
    console.log(formatChecks(checks));
    const worst = worstStatus(checks);
    if (worst === "fail") process.exit(1);
    if (worst === "warn") process.exit(0);
    process.exit(0);
  });

program
  .command("reinstall")
  .description("Re-run first-run setup (provider picker)")
  .option("--mode <mode>", "Skip the picker: local_llm|openai|anthropic|factual_only")
  .action(async (opts: { mode?: string }) => {
    try {
      const forced = opts.mode as
        | "local_llm"
        | "openai"
        | "anthropic"
        | "factual_only"
        | undefined;
      await runFirstRunPicker({ forcedMode: forced });
    } catch (err) {
      console.error(`✗ ${formatError(err)}`);
      process.exit(1);
    }
  });

// Hidden internal entrypoint used by `spawnDaemon`. Runs the daemon loop
// inside the detached child process.
program
  .command("__daemon-internal <projectRoot>", { hidden: true })
  .action(async (projectRoot: string) => {
    try {
      const config = (await loadConfig()) ?? defaultConfig();
      await runDaemon({ projectRoot, config });
    } catch (err) {
      // Best-effort write to stderr (which is /dev/null in detached mode);
      // logger inside runDaemon also records this.
      console.error(formatError(err));
      process.exit(1);
    }
  });

// Default action: snapshot the current project.
program.action(async () => {
  try {
    const config = (await loadConfig()) ?? defaultConfig();
    let narrative = null;
    if (config.mode !== "factual_only") {
      const file = await claudeCodeSource.discover(process.cwd());
      if (file) {
        const state = await extractState(claudeCodeSource.parse(file), {
          lastTurns: config.snapshot.last_turns,
        });
        const dig = await digest(state, config);
        narrative = dig.narrative;
      }
    }
    const result = await snapshot({ cwd: process.cwd(), config, narrative });
    console.log(`✓ Wrote ${result.handoffPath}`);
    console.log(`✓ Wrote ${result.diffPath}`);
  } catch (err) {
    console.error(`✗ ${formatError(err)}`);
    process.exit(1);
  }
});

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

program.parseAsync(process.argv).catch((err) => {
  console.error(formatError(err));
  process.exit(1);
});
