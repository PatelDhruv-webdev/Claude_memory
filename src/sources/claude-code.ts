import { discoverSession } from "../snapshot/discover.js";
import { parseSessionFile } from "../snapshot/parse.js";
import type { RawEvent } from "../snapshot/types.js";

export interface SourceAdapter {
  name: string;
  discover(projectRoot: string): Promise<string | null>;
  parse(path: string): AsyncIterable<RawEvent>;
}

export const claudeCodeSource: SourceAdapter = {
  name: "claude-code",
  discover: discoverSession,
  parse: parseSessionFile,
};
