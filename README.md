# continuum

Automatic session-handoff daemon for AI coding agents.

continuum watches your Claude Code session in the background. When the session
ends (rate limit, idle timeout, manual exit), it produces:

- `HANDOFF.md` — a structured handoff in the project root
- `HANDOFF.diff` — the current `git diff HEAD`

Paste `HANDOFF.md` into any other AI agent (Codex, Cursor, Gemini, Aider) and
continue working without losing context.

## Status

**Phase 1 — snapshot module.** `continuum snapshot` works end-to-end and
produces a populated `HANDOFF.md`. The three LLM narrative sections show a
`_(not generated)_` placeholder until Phase 3.

Daemon, provider picker (Ollama / OpenAI / Anthropic), and LLM digest are not
yet wired — see `/root/.claude/plans/continuum-build-happy-hopper.md` for the
full build plan.

## Install (local dev)

```bash
pnpm install
pnpm build
node dist/cli.js snapshot
```

## Commands

| Command               | Status                  |
|-----------------------|-------------------------|
| `continuum snapshot`  | working                 |
| `continuum`           | one-shot snapshot (Phase 1); daemon in Phase 4 |
| `continuum start`     | Phase 4                 |
| `continuum stop`      | Phase 4                 |
| `continuum status`    | Phase 4                 |
| `continuum logs`      | Phase 4                 |
| `continuum config`    | Phase 2                 |
| `continuum reinstall` | Phase 2                 |

## Tests

```bash
pnpm test
```
