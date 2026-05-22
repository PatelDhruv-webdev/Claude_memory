export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const max = opts.retries;
  const base = opts.baseDelayMs;
  const cap = opts.maxDelayMs ?? 30_000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === max) break;
      if (opts.shouldRetry && !opts.shouldRetry(err, attempt)) break;
      const delay = Math.min(cap, base * Math.pow(2, attempt));
      if (opts.onRetry) opts.onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
