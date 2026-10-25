// Transaction-call admission: at most two active getTransaction calls per process and, with a
// shared lease store, provider-wide; plus a shared per-method cooldown after a 429.
import { randomUUID } from "node:crypto";
import { isLeaseStore, type CacheStore, type RpcAdmission, type RpcContext } from "./types";

export const MAX_ACTIVE = 2;
/** Lease expiry must exceed the transport's 5 s per-attempt timeout. */
export const LEASE_TTL_MS = 8_000;
export const POLL_MS = 100;
/** Methods admission gates; anything else passes straight through. */
export const GATED_METHODS: ReadonlySet<string> = new Set(["getTransaction"]);

export class AdmissionTimeout extends Error {
  constructor(method: string) {
    super(`admission for ${method} not granted before the request deadline`);
    this.name = "AdmissionTimeout";
  }
}

export type AdmissionOptions = {
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  provider?: string;
};

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

const NOOP = { release: async () => {} };

export function createHistoryAdmission(store: CacheStore, options: AdmissionOptions = {}): RpcAdmission {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const provider = options.provider ?? "rpc";
  let active = 0;
  const localCooldown = new Map<string, number>();
  const leases = isLeaseStore(store) ? store : null;

  const stopped = (ctx: RpcContext) => ctx.signal?.aborted || (ctx.deadlineAt !== undefined && now() >= ctx.deadlineAt);
  const waitOrFail = async (method: string, ctx: RpcContext, ms: number) => {
    if (ctx.deadlineAt !== undefined && now() + ms > ctx.deadlineAt) {
      // Do not sleep past the request budget.
      await sleep(Math.max(0, ctx.deadlineAt - now()), ctx.signal);
      throw new AdmissionTimeout(method);
    }
    await sleep(ms, ctx.signal);
    if (stopped(ctx)) throw new AdmissionTimeout(method);
  };

  async function cooldownUntil(method: string): Promise<number> {
    let until = localCooldown.get(method) ?? 0;
    try {
      until = Math.max(until, (await store.get<number>(`cooldown:${provider}:${method}`)) ?? 0);
    } catch {
      /* shared store unavailable: local cooldown only */
    }
    return until;
  }

  async function sharedLease(method: string, ctx: RpcContext): Promise<{ key: string; owner: string } | null> {
    if (!leases) return null;
    const owner = randomUUID();
    for (;;) {
      for (let slot = 0; slot < MAX_ACTIVE; slot++) {
        const key = `lease:${provider}:${method}:${slot}`;
        try {
          if (await leases.tryLease(key, owner, LEASE_TTL_MS)) return { key, owner };
        } catch {
          return null; // Redis temporarily unavailable: local two-call admission still applies.
        }
      }
      await waitOrFail(method, ctx, POLL_MS);
    }
  }

  return {
    async acquire(method, ctx) {
      if (!GATED_METHODS.has(method)) return NOOP;
      if (stopped(ctx)) throw new AdmissionTimeout(method);
      for (let until = await cooldownUntil(method); until > now(); until = await cooldownUntil(method))
        await waitOrFail(method, ctx, until - now());
      while (active >= MAX_ACTIVE) await waitOrFail(method, ctx, POLL_MS);
      active++;
      let lease: { key: string; owner: string } | null;
      try {
        lease = await sharedLease(method, ctx);
      } catch (e) {
        active--;
        throw e;
      }
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          active--;
          if (lease && leases) {
            try {
              await leases.releaseLease(lease.key, lease.owner); // only deletes our own owner token
            } catch {
              /* lease expires on its own */
            }
          }
        },
      };
    },
    async noteRateLimit(method, retryAfterMs) {
      const until = now() + Math.max(0, retryAfterMs);
      localCooldown.set(method, Math.max(localCooldown.get(method) ?? 0, until));
      try {
        await store.set(`cooldown:${provider}:${method}`, until, Math.max(1, Math.ceil(retryAfterMs / 1000)));
      } catch {
        /* local cooldown still applies */
      }
    },
  };
}
