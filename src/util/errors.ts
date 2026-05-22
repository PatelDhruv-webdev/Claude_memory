/**
 * Typed errors so callers can branch on .code without parsing messages.
 * All user-facing errors should extend ContinuumError.
 */
export class ContinuumError extends Error {
  readonly code: string;
  readonly hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.name = "ContinuumError";
  }
}

export class NoSessionError extends ContinuumError {
  constructor(projectRoot: string) {
    super(
      "NO_SESSION",
      `No Claude Code session found for ${projectRoot}.`,
      "Use Claude Code in this directory at least once, then re-run.",
    );
  }
}

export class ConfigError extends ContinuumError {
  constructor(message: string, hint?: string) {
    super("CONFIG", message, hint);
  }
}

export class InstallError extends ContinuumError {
  constructor(message: string, hint?: string) {
    super("INSTALL", message, hint);
  }
}

export class ProviderError extends ContinuumError {
  constructor(message: string, hint?: string) {
    super("PROVIDER", message, hint);
  }
}

export class DaemonError extends ContinuumError {
  constructor(message: string, hint?: string) {
    super("DAEMON", message, hint);
  }
}

export function formatError(err: unknown): string {
  if (err instanceof ContinuumError) {
    return err.hint ? `${err.message}\n  hint: ${err.hint}` : err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
