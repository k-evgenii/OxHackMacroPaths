// The single owner of RPC retries. Server-only.
//
// - one SDK Connection per reader (lazy; created on first live read)
// - at most three attempts, five seconds each, never past the caller's deadline
// - HTTP status and Retry-After are captured at the fetch layer (the SDK discards headers)
// - transaction admission is acquired per attempt and released in `finally`; backoff holds no lease
import "./server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Connection } from "@solana/web3.js";
import { ADMITTED_METHODS, createLocalAdmission, withDegradedFallback } from "./admission";
import { readRpcConfig } from "./config";
import { RpcFailure, type RpcFailureKind } from "./errors";
import { backoffDelay, parseRetryAfter } from "./retry-after";
import type { RpcAdmission, RpcContext, RpcMetric, RpcReader } from "./types";

export const ATTEMPT_TIMEOUT_MS = 5_000;
export const MAX_ATTEMPTS = 3;
/** The activity route's whole-request budget; callers pass `deadlineAt = start + HISTORY_BUDGET_MS`. */
export const HISTORY_BUDGET_MS = 20_000;

/** Mutable for compatibility with existing tests (`retryConfig.baseMs = 1`). */
export const retryConfig = { attempts: MAX_ATTEMPTS, baseMs: 400, capMs: 4_000, attemptTimeoutMs: ATTEMPT_TIMEOUT_MS };

type FetchFn = typeof fetch;
type AttemptSlot = { signal: AbortSignal; status?: number; retryAfter?: string | null };
const attemptStore = new AsyncLocalStorage<AttemptSlot>();

/**
 * Wrap a fetch so each request inherits the current attempt's AbortSignal (so a timeout really stops the HTTP
 * request) and records non-2xx status plus Retry-After before the SDK turns the response into a string error.
 */
export function instrumentFetch(base: FetchFn): FetchFn {
  return (async (input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => {
    const slot = attemptStore.getStore();
    const signal = slot ? (init?.signal ? AbortSignal.any([init.signal, slot.signal]) : slot.signal) : init?.signal;
    const res = await base(input, { ...init, signal });
    if (slot && !res.ok) {
      slot.status = res.status;
      slot.retryAfter = res.headers.get("retry-after");
    }
    return res;
  }) as FetchFn;
}

export type ReaderDeps = {
  /** Build the SDK connection; default reads RPC_URL lazily and uses `fetch`. */
  connect?: () => Connection;
  fetch?: FetchFn;
  env?: Record<string, string | undefined>;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onMetric?: (m: RpcMetric) => void;
  onDegraded?: (err: unknown) => void;
  /** Bounded per-process gate used when the shared gate errors. */
  localAdmission?: RpcAdmission;
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const TRANSIENT_TEXT = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error|\b50[0234]\b/i;
const RATE_LIMIT_TEXT = /\b429\b|too many requests/i;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Classify an attempt failure using the structured status first, the SDK's message only as a fallback. */
function classify(e: unknown, slot: AttemptSlot): { kind: RpcFailureKind; status?: number } {
  if (e instanceof RpcFailure && e.kind !== "unknown") return { kind: e.kind, status: e.status };
  const status = slot.status;
  if (status === 429) return { kind: "rate_limited", status };
  if (status !== undefined && RETRYABLE_STATUS.has(status)) return { kind: "transient", status };
  if (status !== undefined) return { kind: "upstream", status };
  const m = errText(e);
  if (RATE_LIMIT_TEXT.test(m)) return { kind: "rate_limited", status: 429 };
  if (TRANSIENT_TEXT.test(m)) return { kind: "transient" };
  return { kind: "upstream" };
}

const RETRY_KINDS: ReadonlySet<RpcFailureKind> = new Set(["rate_limited", "transient", "timeout"]);

const TIMEOUT = Symbol("timeout");
const terminal = new WeakSet<object>();
const CANCEL = Symbol("cancel");

/** Create the admitted RPC reader (frozen port). `admission` is the shared gate; a local bounded gate backs it. */
export function createRpcReader(admission: RpcAdmission, deps: ReaderDeps = {}): RpcReader {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? defaultSleep;
  const onMetric = deps.onMetric ?? (() => {});
  const gate = withDegradedFallback(admission, deps.localAdmission ?? createLocalAdmission({ now }), deps.onDegraded);
  let connection: Connection | undefined;
  const connect =
    deps.connect ??
    (() => {
      const { url } = readRpcConfig(deps.env);
      return new Connection(url, {
        commitment: "confirmed",
        disableRetryOnRateLimit: true, // this reader owns retries
        fetch: instrumentFetch(deps.fetch ?? fetch),
      });
    });
  const getConnection = () => (connection ??= connect());

  return {
    async read<T>(method: string, op: (c: Connection) => Promise<T>, context: RpcContext = {}): Promise<T> {
      const started = now();
      const m: RpcMetric = { method, attempts: 0, durationMs: 0, outcome: "error", throttled: 0, timedOut: 0, cooldownMs: 0 };
      const finish = (failure?: RpcFailure) => {
        m.durationMs = now() - started;
        m.outcome = failure ? "error" : "ok";
        if (failure) m.failureKind = failure.kind;
        onMetric(m);
      };
      const fail = (kind: RpcFailureKind, message: string, cause?: unknown, extra: { status?: number; retryAfterMs?: number } = {}) => {
        const f = new RpcFailure(`${method}: ${message}`, cause, { kind, attempts: m.attempts, ...extra });
        terminal.add(f);
        finish(f);
        return f;
      };

      const conn = (() => {
        try {
          return getConnection();
        } catch (e) {
          throw e instanceof RpcFailure ? (finish(e), e) : fail("config", errText(e), e);
        }
      })();

      const caller = context.signal;
      let last: RpcFailure | undefined;
      const maxAttempts = Math.min(retryConfig.attempts, MAX_ATTEMPTS);
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (caller?.aborted) throw fail("aborted", "request cancelled", caller.reason);
        const remaining = context.deadlineAt === undefined ? Infinity : context.deadlineAt - now();
        if (remaining <= 0) throw last ? (finish(last), last) : fail("deadline", "request budget exhausted before the attempt");

        let lease: { release(): Promise<void> } | undefined;
        const ctrl = new AbortController();
        const slot: AttemptSlot = { signal: ctrl.signal };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onCallerAbort = () => ctrl.abort(CANCEL);
        try {
          if (ADMITTED_METHODS.has(method)) {
            try {
              lease = await gate.acquire(method, context);
            } catch (e) {
              if (e instanceof RpcFailure) throw fail(e.kind, e.message, e);
              throw fail("unknown", "admission failed", e);
            }
          }
          m.attempts = attempt;
          const budget = Math.min(retryConfig.attemptTimeoutMs, context.deadlineAt === undefined ? Infinity : context.deadlineAt - now());
          if (budget <= 0) throw fail("deadline", "request budget exhausted before the attempt");
          caller?.addEventListener("abort", onCallerAbort, { once: true });
          if (caller?.aborted) ctrl.abort(CANCEL);
          const stop = new Promise<never>((_, reject) => {
            const onAbort = () => reject(ctrl.signal.reason);
            if (ctrl.signal.aborted) onAbort();
            else ctrl.signal.addEventListener("abort", onAbort, { once: true });
          });
          stop.catch(() => {});
          timer = setTimeout(() => ctrl.abort(TIMEOUT), budget);
          const value = await attemptStore.run(slot, () => Promise.race([op(conn), stop]));
          finish();
          return value;
        } catch (e) {
          if (terminal.has(e as object)) throw e;
          if (ctrl.signal.reason === CANCEL || caller?.aborted) throw fail("aborted", "request cancelled", caller?.reason ?? e);
          let kind: RpcFailureKind;
          let status: number | undefined;
          if (ctrl.signal.reason === TIMEOUT) {
            const hitDeadline = context.deadlineAt !== undefined && now() >= context.deadlineAt;
            kind = hitDeadline ? "deadline" : "timeout";
            m.timedOut++;
          } else {
            ({ kind, status } = classify(e, slot));
          }
          const retryAfterMs = parseRetryAfter(slot.retryAfter, now());
          if (kind === "rate_limited") m.throttled++;
          const message = kind === "timeout" ? `attempt timed out after ${retryConfig.attemptTimeoutMs} ms` : errText(e);
          last = new RpcFailure(`${method}: ${message}`, e, { kind, status, retryAfterMs, attempts: attempt });
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          caller?.removeEventListener("abort", onCallerAbort);
          if (lease) await lease.release(); // never hold a lease through backoff
        }

        if (!RETRY_KINDS.has(last.kind) || attempt >= maxAttempts) break;
        const delay = backoffDelay(attempt, random, last.retryAfterMs, retryConfig.baseMs, retryConfig.capMs);
        if (last.kind === "rate_limited") {
          const cool = last.retryAfterMs ?? delay;
          m.cooldownMs += cool;
          await gate.noteRateLimit(method, cool).catch(() => {});
        }
        if (context.deadlineAt !== undefined && now() + delay >= context.deadlineAt) break; // never sleep past the budget
        try {
          await sleep(delay, caller);
        } catch (e) {
          throw fail("aborted", "request cancelled", e);
        }
      }
      finish(last!);
      throw last!;
    },
  };
}

let defaultReader: RpcReader | undefined;
let defaultAdmission: RpcAdmission | undefined;
let metricSink: ((m: RpcMetric) => void) | undefined;

/** Composition hook: production wiring injects Agent 03's shared admission and a metrics sink. */
export function configureDefaultReader(opts: { admission?: RpcAdmission; onMetric?: (m: RpcMetric) => void }): void {
  if (opts.admission) defaultAdmission = opts.admission;
  if (opts.onMetric) metricSink = opts.onMetric;
  defaultReader = undefined;
}

/** The process-wide reader (lazy; no connection or config read until first use). */
export function getDefaultReader(): RpcReader {
  return (defaultReader ??= createRpcReader(defaultAdmission ?? createLocalAdmission(), {
    onMetric: (m) => metricSink?.(m),
  }));
}

/** Drop the cached default reader/connection (tests, config changes). */
export function resetDefaultReader(): void {
  defaultReader = undefined;
}
