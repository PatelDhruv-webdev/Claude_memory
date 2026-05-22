import type {
  Command,
  ContentBlock,
  ErrorEntry,
  RawEvent,
  SessionState,
  TokenUsage,
  Turn,
} from "./types.js";

const FILE_TOOLS = new Set([
  "Edit",
  "Write",
  "Read",
  "MultiEdit",
  "NotebookEdit",
]);

function textFromContent(
  content: string | ContentBlock[] | undefined,
): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("\n");
}

function asContentBlocks(
  content: string | ContentBlock[] | undefined,
): ContentBlock[] {
  if (!content || typeof content === "string") return [];
  return content;
}

interface PendingToolUse {
  name: string;
  input: Record<string, unknown>;
  timestamp?: string;
}

export async function extractState(
  events: AsyncIterable<RawEvent>,
  opts: { lastTurns: number },
): Promise<SessionState> {
  const state: SessionState = {
    goal: "",
    filesTouched: new Map(),
    commands: [],
    errors: [],
    tokenUsage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    stopReason: null,
    lastTurns: [],
  };

  const pendingTools = new Map<string, PendingToolUse>();
  const turns: Turn[] = [];
  let goalSet = false;

  for await (const ev of events) {
    if (!state.sessionId && ev.sessionId) state.sessionId = ev.sessionId;
    if (ev.timestamp) {
      if (!state.firstTimestamp) state.firstTimestamp = ev.timestamp;
      state.lastTimestamp = ev.timestamp;
    }

    const msg = ev.message;
    const role = msg?.role;

    if (msg?.usage) {
      state.tokenUsage = addUsage(state.tokenUsage, msg.usage);
    }

    if (role === "user") {
      const blocks = asContentBlocks(msg!.content);
      const toolResults = blocks.filter((b) => b.type === "tool_result");

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          handleToolResult(tr, pendingTools, state);
        }
      } else {
        const text = textFromContent(msg!.content).trim();
        if (text) {
          if (!goalSet) {
            state.goal = text;
            goalSet = true;
          }
          turns.push({ role: "user", text, timestamp: ev.timestamp });
        }
      }
    } else if (role === "assistant") {
      const blocks = asContentBlocks(msg!.content);
      const toolUses = blocks.filter((b) => b.type === "tool_use");
      const text = textFromContent(msg!.content).trim();

      if (text) {
        turns.push({ role: "assistant", text, timestamp: ev.timestamp });
      }

      for (const tu of toolUses) {
        handleToolUse(tu, pendingTools, state, ev.timestamp);
      }

      if (msg?.stop_reason !== undefined && msg.stop_reason !== null) {
        state.stopReason = msg.stop_reason;
      }
    }
  }

  state.lastTurns = turns.slice(-opts.lastTurns);
  return state;
}

function addUsage(
  total: TokenUsage,
  usage: NonNullable<RawEvent["message"]>["usage"],
): TokenUsage {
  return {
    input: total.input + (usage?.input_tokens ?? 0),
    output: total.output + (usage?.output_tokens ?? 0),
    cacheCreate: total.cacheCreate + (usage?.cache_creation_input_tokens ?? 0),
    cacheRead: total.cacheRead + (usage?.cache_read_input_tokens ?? 0),
  };
}

function handleToolUse(
  tu: ContentBlock,
  pendingTools: Map<string, PendingToolUse>,
  state: SessionState,
  timestamp: string | undefined,
): void {
  const id = (tu as { id?: string }).id;
  const name = tu.name ?? "";
  const input = (tu.input ?? {}) as Record<string, unknown>;

  if (id) {
    pendingTools.set(id, { name, input, timestamp });
  }

  if (FILE_TOOLS.has(name)) {
    const path =
      (input.file_path as string | undefined) ??
      (input.notebook_path as string | undefined);
    if (path) {
      const ft = state.filesTouched.get(path) ?? {
        path,
        reads: 0,
        edits: 0,
        writes: 0,
      };
      if (name === "Read") ft.reads += 1;
      else if (name === "Write") ft.writes += 1;
      else ft.edits += 1; // Edit, MultiEdit, NotebookEdit
      state.filesTouched.set(path, ft);
    }
  }
}

function handleToolResult(
  tr: ContentBlock,
  pendingTools: Map<string, PendingToolUse>,
  state: SessionState,
): void {
  const id = tr.tool_use_id;
  const pending = id ? pendingTools.get(id) : undefined;
  const isError = tr.is_error === true;

  const resultText =
    typeof tr.content === "string"
      ? tr.content
      : Array.isArray(tr.content)
        ? (tr.content as ContentBlock[])
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text!)
            .join("\n")
        : "";

  if (pending?.name === "Bash") {
    const cmd: Command = {
      command: (pending.input.command as string) ?? "",
      description: pending.input.description as string | undefined,
      output: truncate(resultText, 500),
    };
    state.commands.push(cmd);
  }

  if (isError) {
    state.errors.push({
      toolName: pending?.name,
      message: truncate(resultText, 1000),
      timestamp: pending?.timestamp,
    });
  }

  if (id) pendingTools.delete(id);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "… (truncated)";
}
