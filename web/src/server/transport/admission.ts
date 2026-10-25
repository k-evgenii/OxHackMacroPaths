// Admission seams. The frozen RpcAdmission port is implemented with Redis by Agent 03; this module provides
// the per-process bounded fallback used when that shared gate is unavailable (degraded mode) or not composed.
import "./server-only";
import { RpcFailure } from "./errors";
import type { RpcAdmission, RpcContext, RpcLease } from "./types";

/** Methods that occupy transaction admission slots. Account reads never do. */
export const ADMITTED_METHODS: ReadonlySet<string> = new Set(["getTransaction"]);
export const TRANSACTION_CONCURRENCY = 2;

const NOOP_LEASE: RpcLease = { release: async () => {} };

function abortReason(ctx: RpcContext): RpcFailure {
  return new RpcFailure("RPC request cancelled while waiting for admission", ctx.signal?.reason, { kind: "aborted" });
}

/**
 * Per-process admission: at most `limit` concurrent leases for admitted methods, FIFO,
 * honoring cancellation and deadlines while queued. Also keeps a local per-method cooldown.
 */
export function createLocalAdmission(
  opts: { limit?: number; now?: () => number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout } = {},
): RpcAdmission & { active(): number; cooldownUntil(method: string): number } {
  const limit = opts.limit ?? TRANSACTION_CONCURRENCY;
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? setTimeout;
  const clearTimer = opts.clearTimer ?? clearTimeout;
  let active = 0;
  const waiters: Array<() => void> = [];
  const cooldowns = new Map<string, number>();

  const grant = (): RpcLease => {
    active++;
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        active--;
        waiters.shift()?.();
      },
    };
  };

  return {
    active: () => active,
    cooldownUntil: (m) => cooldowns.get(m) ?? 0,
    async noteRateLimit(method, retryAfterMs) {
      cooldowns.set(method, Math.max(cooldowns.get(method) ?? 0, now() + Math.max(0, retryAfterMs)));
    },
    acquire(method, ctx) {
      if (ctx.signal?.aborted) return Promise.reject(abortReason(ctx));
      if (!ADMITTED_METHODS.has(method)) return Promise.resolve(NOOP_LEASE);
      if (active < limit) return Promise.resolve(grant());
      return new Promise<RpcLease>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
          const i = waiters.indexOf(wake);
          if (i >= 0) waiters.splice(i, 1);
          if (timer !== undefined) clearTimer(timer);
          ctx.signal?.removeEventListener("abort", onAbort);
        };
        const wake = () => {
          cleanup();
          resolve(grant());
        };
        const onAbort = () => {
          cleanup();
          reject(abortReason(ctx));
        };
        waiters.push(wake);
        ctx.signal?.addEventListener("abort", onAbort, { once: true });
        if (ctx.deadlineAt !== undefined) {
          timer = setTimer(() => {
            cleanup();
            reject(new RpcFailure("RPC request budget expired while waiting for admission", undefined, { kind: "deadline" }));
          }, Math.max(0, ctx.deadlineAt - now()));
        }
      });
    },
  };
}

/**
 * Prefer the shared (Redis) gate; if it errors (unavailable), fall back to the bounded local gate so a single
 * process still never exceeds TRANSACTION_CONCURRENCY. Cancellation/deadline failures propagate unchanged.
 */
export function withDegradedFallback(
  shared: RpcAdmission,
  local: RpcAdmission = createLocalAdmission(),
  onDegraded: (err: unknown) => void = () => {},
): RpcAdmission {
  return {
    async acquire(method, ctx) {
      try {
        return await shared.acquire(method, ctx);
      } catch (e) {
        if (e instanceof RpcFailure && (e.kind === "aborted" || e.kind === "deadline")) throw e;
        if (ctx.signal?.aborted) throw abortReason(ctx);
        onDegraded(e);
        return local.acquire(method, ctx);
      }
    },
    async noteRateLimit(method, retryAfterMs) {
      await local.noteRateLimit(method, retryAfterMs);
      try {
        await shared.noteRateLimit(method, retryAfterMs);
      } catch (e) {
        onDegraded(e);
      }
    },
  };
}
