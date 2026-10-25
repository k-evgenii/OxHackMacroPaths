// Server-only RPC access. The browser never sees RPC_URL.
import { Connection } from "@solana/web3.js";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

let connection: Connection | undefined;

/** One Connection per process, commitment "confirmed". */
export function getConnection(): Connection {
  connection ??= new Connection(RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true }); // rpc() owns 429 backoff
  return connection;
}

type Entry = { value: unknown; expires: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Memoize `fn` under `key` for `ttlMs` (a number, or a function of the result).
 * Concurrent callers share one in-flight request; failures are not cached.
 */
export async function cached<T>(key: string, ttlMs: number | ((v: T) => number), fn: () => Promise<T>): Promise<T> {
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
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function clearCache(): void {
  cache.clear();
  inflight.clear();
}

/** Thrown for any failure talking to the RPC node; mapped to 502 rpc_error. */
export class RpcFailure extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RpcFailure";
  }
}

export const retryConfig = { attempts: 4, baseMs: 400 };

const isRateLimited = (e: unknown) => /429|too many requests/i.test(e instanceof Error ? e.message : String(e));

/** Run an RPC call, retrying with exponential backoff on HTTP 429; wraps errors in RpcFailure. */
export async function rpc<T>(label: string, fn: (c: Connection) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(getConnection());
    } catch (e) {
      if (isRateLimited(e) && attempt < retryConfig.attempts) {
        await new Promise((r) => setTimeout(r, retryConfig.baseMs * 2 ** (attempt - 1)));
        continue;
      }
      throw new RpcFailure(`${label}: ${e instanceof Error ? e.message : String(e)}`, e);
    }
  }
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
