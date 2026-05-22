import { z } from "zod";

const ContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
}).passthrough();

const MessageSchema = z.object({
  role: z.string().optional(),
  content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
  stop_reason: z.string().nullable().optional(),
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();

export const RawEventSchema = z.object({
  type: z.string(),
  isMeta: z.boolean().optional(),
  timestamp: z.string().optional(),
  message: MessageSchema.optional(),
  toolUseResult: z.unknown().optional(),
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  sessionId: z.string().optional(),
}).passthrough();

export type RawEvent = z.infer<typeof RawEventSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export interface FileTouch {
  path: string;
  reads: number;
  edits: number;
  writes: number;
}

export interface Command {
  command: string;
  description?: string;
  exitCode?: number;
  output?: string;
}

export interface ErrorEntry {
  toolName?: string;
  message: string;
  timestamp?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
}

export interface SessionState {
  goal: string;
  filesTouched: Map<string, FileTouch>;
  commands: Command[];
  errors: ErrorEntry[];
  tokenUsage: TokenUsage;
  stopReason: string | null;
  lastTurns: Turn[];
  sessionId?: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export interface NarrativeSections {
  what_we_did: string;
  decisions_made: string;
  rejected_approaches: string;
}

export interface GitInfo {
  branch: string;
  lastCommit: string;
  status: string;
  diff: string;
  isRepo: boolean;
}

export interface RenderMeta {
  generatedAt: string;
  projectPath: string;
  sourceFile: string;
  lastTurnsCount: number;
}
