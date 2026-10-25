// Server-only RPC entrypoint (`@/server/rpc`). The browser never sees RPC_URL.
// Retries, timeouts, Retry-After and admission live in ./transport; this module keeps the compatibility
// surface (`rpc`, `cached`, `mapLimit`, `RpcFailure`, `retryConfig`) used by unchanged routes.
import type { Connection } from "@solana/web3.js";
import { getDefaultReader, resetDefaultReader, RpcFailure, type RpcContext } from "./transport";

export {
  RpcFailure,
  RpcConfigError,
  createRpcReader,
  configureDefaultReader,
  createLocalAdmission,
  withDegradedFallback,
  retryConfig,
  HISTORY_BUDGET_MS,
  ATTEMPT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  type RpcAdmission,
  type RpcContext,
  type RpcReader,
  type RpcFailureKind,
  type RpcMetric,
} from "./transport";

/** Run an RPC call through the process-wide admitted reader (bounded retries, 5 s attempts). */
export function rpc<T>(label: string, fn: (c: Connection) => Promise<T>, context?: RpcContext): Promise<T> {
  return getDefaultReader().read(label, fn, context);
}

type Entry = { value: unknown; expires: number };
/** An expired entry may still be served when the RPC call fails (rate limit, outage) for this long. */
export const STALE_MAX_MS = 5 * 60_000;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Memoize `fn` under `key` for `ttlMs` (a number, or a function of the result).
 * Concurrent callers share one in-flight request; failures are not cached.
 * If a refresh fails, an entry expired less than STALE_MAX_MS ago is served instead (`stale: false` opts out).
 */
export async function cached<T>(
  key: string,
  ttlMs: number | ((v: T) => number),
  fn: () => Promise<T>,
  opts: { stale?: boolean } = {},
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = fn()
    .then((value) => {
      const ttl = typeof ttlMs === "function" ? ttlMs(value) : ttlMs;
      if (ttl > 0) cache.set(key, { value, expires: Date.now() + ttl });
      return value;
    })
    .catch((e: unknown) => {
      if (opts.stale !== false && e instanceof RpcFailure && e.kind !== "config" && hit && Date.now() - hit.expires < STALE_MAX_MS) {
        console.warn(`[api] RPC failed for ${key}; serving the last good read`, e.message);
        return hit.value as T;
      }
      throw e;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function clearCache(): void {
  cache.clear();
  inflight.clear();
  resetDefaultReader();
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
