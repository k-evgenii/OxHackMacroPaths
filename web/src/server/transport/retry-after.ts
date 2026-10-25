import "./server-only";

/** Parse an HTTP Retry-After value (delta-seconds or HTTP-date) into milliseconds from `now`. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

export const BACKOFF = { baseMs: 400, capMs: 4000 } as const;

/** Full-jitter exponential backoff for retry number `retry` (1-based), floored by Retry-After. */
export function backoffDelay(
  retry: number,
  random: () => number,
  retryAfterMs: number | undefined,
  base: number = BACKOFF.baseMs,
  cap: number = BACKOFF.capMs,
): number {
  const jitter = Math.floor(random() * Math.min(cap, base * 2 ** (retry - 1)));
  return Math.max(jitter, retryAfterMs ?? 0);
}
