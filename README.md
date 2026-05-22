# continuum

Automatic session-handoff daemon for AI coding agents.

continuum watches your Claude Code session in the background. When the session
ends (rate limit, idle timeout, manual exit), it produces:

- `HANDOFF.md` — a structured handoff in the project root
- `HANDOFF.diff` — the current `git diff HEAD`

Paste `HANDOFF.md` into any other AI agent (Codex, Cursor, Gemini, Aider) and
continue working without losing context.

## Status

All five phases scaffolded:

| Phase | Surface                              | State    |
|-------|--------------------------------------|----------|
| 1     | `continuum snapshot`, parse/extract  | working  |
| 2     | First-run picker, Ollama install     | working  |
| 3     | LLM digest (Ollama / OpenAI / Anthropic) | working |
| 4     | Daemon (`start`, `stop`, `status`)   | working  |
| 5     | `logs`, `config`, `reinstall`        | working  |

## Install (local dev)

```bash
pnpm install
pnpm build
node dist/cli.js reinstall   # first-run picker
node dist/cli.js start       # watch this project in the background
```

## Commands

| Command                          | What it does                                                |
|----------------------------------|-------------------------------------------------------------|
| `continuum snapshot`             | One-shot: produce HANDOFF.md from the current session       |
| `continuum snapshot --no-llm`    | Same, skipping the LLM digest                               |
| `continuum resume [--to <agent>]`| Print a primer for pasting into the next agent (`claude` / `codex` / `cursor` / `aider` / `generic`) |
| `continuum resume --copy`        | Copy the primer to the system clipboard instead of printing |
| `continuum doctor`               | Diagnose: config, Ollama, session, daemon, log              |
| `continuum start`                | Spawn a detached daemon watching this project               |
| `continuum stop`                 | Stop the daemon (SIGTERM, falls back to SIGKILL after 5s)   |
| `continuum status`               | Show PID + watched project, or "not running"                |
| `continuum logs [-n N] [--all]`  | Tail the daemon log                                         |
| `continuum config`               | Open `~/.continuum/config.yml` in $EDITOR                   |
| `continuum reinstall`            | Re-run the provider picker                                  |
| `continuum reinstall --mode X`   | Skip the picker (`local_llm`, `openai`, `anthropic`, `factual_only`) |

## Provider modes

- **`local_llm`** — Ollama on localhost; default model `qwen2.5:3b`. continuum
  installs Ollama for you (Linux/macOS only) and pulls the model.
- **`external_api`** — OpenAI or Anthropic. The key lives in an env var; only
  the env var **name** is stored in config.
- **`factual_only`** — no LLM at all; narrative sections show as not-generated.

## Tests

```bash
pnpm test         # 156 tests across 26 files (incl. daemon integration test)
pnpm typecheck    # strict TS, noUncheckedIndexedAccess on
```

## Architecture

```
src/
├── cli.ts                  commander wiring
├── snapshot/               session JSONL → HANDOFF.md
│   ├── discover.ts         find newest non-agent .jsonl for cwd
│   ├── parse.ts            streaming JSONL → RawEvent
│   ├── extract.ts          RawEvent → SessionState (single fold)
│   ├── git.ts              execFile-based, never shell
│   ├── render.ts           SessionState → markdown
│   ├── history.ts          rotate previous HANDOFF into ~/.continuum/history
│   └── index.ts            orchestrator (atomic writes)
├── sources/claude-code.ts  SourceAdapter (Codex/Cursor seam)
├── config/{schema,io}.ts   YAML + zod, atomic writes, broken-file backup
├── providers/              Ollama install/pull + API key validators
├── llm/                    digest, prompt builder, tolerant JSON parser
├── onboarding/             first-run picker, non-TTY safe
├── daemon/                 watcher (chokidar), pidfile, trigger engine
└── util/                   atomic write, retry, errors, paths, logger
```
