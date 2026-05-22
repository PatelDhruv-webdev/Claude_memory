import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function continuumDir(): string {
  return join(homedir(), ".continuum");
}

export function configPath(): string {
  return join(continuumDir(), "config.yml");
}

export function pidPath(): string {
  return join(continuumDir(), "daemon.pid");
}

export function logPath(): string {
  return join(continuumDir(), "log.jsonl");
}

export function historyDir(): string {
  return join(continuumDir(), "history");
}

export function claudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * Claude Code encodes project paths by replacing every "/" with "-".
 * An absolute path like "/Users/me/proj" becomes "-Users-me-proj".
 * The leading hyphen is intentional and must be preserved.
 */
export function encodeProjectPath(absPath: string): string {
  const abs = resolve(absPath);
  return abs.replaceAll("/", "-");
}
