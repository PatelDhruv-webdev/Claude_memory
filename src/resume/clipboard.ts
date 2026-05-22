import { spawn } from "node:child_process";
import { platform } from "node:os";

export interface ClipboardResult {
  ok: boolean;
  tool: string | null;
  error?: string;
}

/**
 * Copy text to the system clipboard. Uses the platform-native tool:
 *   macOS:   pbcopy
 *   Linux:   xclip / wl-copy / xsel (first one found)
 *   Windows: clip.exe
 *
 * Returns { ok: false, error } if no clipboard tool is available; the
 * caller is expected to fall back to printing to stdout.
 */
export async function copyToClipboard(text: string): Promise<ClipboardResult> {
  const candidates = clipboardCandidates();
  for (const c of candidates) {
    try {
      await runWithStdin(c.bin, c.args, text);
      return { ok: true, tool: c.bin };
    } catch (err) {
      // try next
      void err;
    }
  }
  return { ok: false, tool: null, error: "no clipboard tool found" };
}

interface Candidate {
  bin: string;
  args: string[];
}

function clipboardCandidates(): Candidate[] {
  const p = platform();
  if (p === "darwin") return [{ bin: "pbcopy", args: [] }];
  if (p === "win32") return [{ bin: "clip.exe", args: [] }];
  return [
    { bin: "wl-copy", args: [] },
    { bin: "xclip", args: ["-selection", "clipboard"] },
    { bin: "xsel", args: ["--clipboard", "--input"] },
  ];
}

function runWithStdin(bin: string, args: string[], stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited with code ${code}`));
    });
    child.stdin.end(stdin, "utf8");
  });
}
