// Deterministic transport tests: fake clock, jitter, sleep, fetch and admission. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "@solana/web3.js";
import {
  RpcFailure,
  createLocalAdmission,
  createRpcReader,
  parseRetryAfter,
  readRpcConfig,
  retryConfig,
  type RpcAdmission,
  type RpcMetric,
} from "@/server/transport";

const SECRET_URL = "https://rpc.example.invalid/v1/abc123secretkey?api-key=hunter2";

function jsonRpc(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result }), { status: 200, headers: { "content-type": "application/json" } });
}
function httpError(status: number, headers: Record<string, string> = {}): Response {
  return new Response("upstream says no", { status, statusText: "Err", headers });
}

/** Counting fake admission that records the peak number of simultaneously held leases. */
function fakeAdmission(opts: { failAcquire?: boolean } = {}) {
  const log: string[] = [];
  let held = 0;
  let peak = 0;
  const notes: Array<[string, number]> = [];
  const a: RpcAdmission = {
    async acquire(method) {
      if (opts.failAcquire) throw new Error("redis down");
      held++;
      peak = Math.max(peak, held);
      log.push(`acquire:${method}`);
      return {
        release: async () => {
          held--;
          log.push(`release:${method}`);
        },
      };
    },
    async noteRateLimit(method, ms) {
      notes.push([method, ms]);
    },
  };
  return { a, log, notes, held: () => held, peak: () => peak };
}

let clock = 0;
const now = () => clock;
const sleeps: number[] = [];
const sleep = async (ms: number, signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason;
  sleeps.push(ms);
  clock += ms;
};

beforeEach(() => {
  clock = 1_000_000;
  sleeps.length = 0;
  retryConfig.attempts = 3;
  retryConfig.baseMs = 400;
  retryConfig.capMs = 4000;
  retryConfig.attemptTimeoutMs = 5000;
});
afterEach(() => vi.useRealTimers());

function fetchReader(responses: Array<() => Response | Promise<Response>>, admission: RpcAdmission, extra: { metrics?: RpcMetric[]; random?: () => number } = {}) {
  const fetchFn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next();
  });
  const reader = createRpcReader(admission, {
    env: { RPC_URL: SECRET_URL },
    fetch: fetchFn as unknown as typeof fetch,
    now,
    random: extra.random ?? (() => 0.5),
    sleep,
    onMetric: (m) => extra.metrics?.push(m),
  });
  return { reader, fetchFn };
}

describe("retry policy", () => {
  it("successful call performs one attempt", async () => {
    const adm = fakeAdmission();
    const metrics: RpcMetric[] = [];
    const { reader, fetchFn } = fetchReader([() => jsonRpc(42)], adm.a, { metrics });
    await expect(reader.read("getSlot", (c) => c.getSlot())).resolves.toBe(42);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(metrics[0]).toMatchObject({ method: "getSlot", attempts: 1, outcome: "ok", throttled: 0 });
  });

  it("429 with numeric Retry-After waits at least that long within budget, and records cooldown", async () => {
    const adm = fakeAdmission();
    const { reader, fetchFn } = fetchReader([() => httpError(429, { "retry-after": "2" }), () => jsonRpc(7)], adm.a, { random: () => 0 });
    await expect(reader.read("getSlot", (c) => c.getSlot(), { deadlineAt: clock + 20_000 })).resolves.toBe(7);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([2000]);
    expect(adm.notes).toEqual([["getSlot", 2000]]);
  });

  it("parses HTTP-date Retry-After and bounds it", () => {
    const t = Date.parse("Sun, 25 Oct 2026 12:00:00 GMT");
    expect(parseRetryAfter("Sun, 25 Oct 2026 12:00:03 GMT", t)).toBe(3000);
    expect(parseRetryAfter("Sun, 25 Oct 2026 11:59:00 GMT", t)).toBe(0); // past dates never go negative
    expect(parseRetryAfter("1.5", t)).toBe(1500);
    expect(parseRetryAfter("garbage", t)).toBeUndefined();
    expect(parseRetryAfter(null, t)).toBeUndefined();
  });

  it("HTTP-date Retry-After beyond the budget stops instead of sleeping past the deadline", async () => {
    const adm = fakeAdmission();
    const date = new Date(clock + 60_000).toUTCString();
    const { reader, fetchFn } = fetchReader([() => httpError(429, { "retry-after": date })], adm.a);
    const err = await reader.read("getSlot", (c) => c.getSlot(), { deadlineAt: clock + 20_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(RpcFailure);
    expect(err).toMatchObject({ kind: "rate_limited", status: 429, retryable: true, attempts: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("repeated 429 stops after three attempts", async () => {
    const adm = fakeAdmission();
    const metrics: RpcMetric[] = [];
    const { reader, fetchFn } = fetchReader([1, 2, 3, 4].map(() => () => httpError(429)), adm.a, { metrics });
    const err = await reader.read("getSlot", (c) => c.getSlot()).catch((e) => e);
    expect(err).toMatchObject({ kind: "rate_limited", attempts: 3 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((s) => s <= 4000)).toBe(true);
    expect(metrics[0]).toMatchObject({ attempts: 3, throttled: 3, outcome: "error", failureKind: "rate_limited" });
  });

  it("repeated 429 stops earlier when the deadline is exhausted", async () => {
    const adm = fakeAdmission();
    const { reader, fetchFn } = fetchReader([1, 2, 3].map(() => () => httpError(429, { "retry-after": "1" })), adm.a, { random: () => 0 });
    const err = await reader.read("getSlot", (c) => c.getSlot(), { deadlineAt: clock + 1500 }).catch((e) => e);
    expect(err).toMatchObject({ kind: "rate_limited" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("nonretryable failure has one attempt", async () => {
    const adm = fakeAdmission();
    const { reader, fetchFn } = fetchReader([() => httpError(400)], adm.a);
    const err = await reader.read("getSlot", (c) => c.getSlot()).catch((e) => e);
    expect(err).toMatchObject({ kind: "upstream", status: 400, retryable: false, attempts: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const bad = createRpcReader(adm.a, { connect: () => ({}) as Connection, now, sleep });
    const op = vi.fn(async () => {
      throw new Error("Invalid account discriminator");
    });
    await expect(bad.read("getAccountInfo", op)).rejects.toMatchObject({ kind: "upstream" });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("transient network failure and 503 recover with bounded retry", async () => {
    const adm = fakeAdmission();
    const { reader, fetchFn } = fetchReader(
      [
        () => {
          throw new TypeError("fetch failed");
        },
        () => httpError(503),
        () => jsonRpc(9),
      ],
      adm.a,
    );
    await expect(reader.read("getSlot", (c) => c.getSlot())).resolves.toBe(9);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([200, 400]); // full jitter at random=0.5: 0.5*400, 0.5*800
  });
});

describe("timeouts and cancellation", () => {
  it("five-second timeout aborts the underlying request", async () => {
    vi.useFakeTimers();
    retryConfig.attempts = 1;
    const seen: AbortSignal[] = [];
    const fetchFn = vi.fn((_u: unknown, init?: RequestInit) => {
      seen.push(init!.signal!);
      return new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const reader = createRpcReader(fakeAdmission().a, { env: { RPC_URL: SECRET_URL }, fetch: fetchFn as unknown as typeof fetch });
    const p = reader.read("getSlot", (c) => c.getSlot()).catch((e) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(seen[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await p;
    expect(seen[0].aborted).toBe(true);
    expect(err).toMatchObject({ kind: "timeout", retryable: true });
  });

  it("caller cancellation aborts pending work and does not retry", async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    let sig: AbortSignal | undefined;
    const fetchFn = vi.fn((_u: unknown, init?: RequestInit) => {
      sig = init!.signal!;
      return new Promise<Response>(() => {}); // never settles on its own
    });
    const adm = fakeAdmission();
    const reader = createRpcReader(adm.a, { env: { RPC_URL: SECRET_URL }, fetch: fetchFn as unknown as typeof fetch });
    const p = reader.read("getTransaction", (c) => c.getTransaction("1".repeat(64), { maxSupportedTransactionVersion: 0 }), { signal: ctrl.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    ctrl.abort();
    const err = await p;
    expect(sig?.aborted).toBe(true);
    expect(err).toMatchObject({ kind: "aborted", retryable: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(adm.held()).toBe(0);
  });

  it("declines an attempt when the deadline has already passed", async () => {
    const op = vi.fn();
    const reader = createRpcReader(fakeAdmission().a, { connect: () => ({}) as Connection, now, sleep });
    await expect(reader.read("getSlot", op, { deadlineAt: clock - 1 })).rejects.toMatchObject({ kind: "deadline" });
    expect(op).not.toHaveBeenCalled();
  });
});

describe("admission", () => {
  const conn = {} as Connection;

  it("releases after success, failure and abort", async () => {
    const adm = fakeAdmission();
    const reader = createRpcReader(adm.a, { connect: () => conn, now, sleep });
    await reader.read("getTransaction", async () => 1);
    await reader.read("getTransaction", async () => {
      throw new Error("bad data");
    }).catch(() => {});
    const ctrl = new AbortController();
    const p = reader.read("getTransaction", () => new Promise(() => {}), { signal: ctrl.signal }).catch((e) => e);
    await Promise.resolve();
    await Promise.resolve();
    ctrl.abort();
    expect(await p).toMatchObject({ kind: "aborted" });
    expect(adm.held()).toBe(0);
    expect(adm.log.filter((l) => l.startsWith("acquire")).length).toBe(3);
    expect(adm.log.filter((l) => l.startsWith("release")).length).toBe(3);
  });

  it("backoff does not occupy an active lease; each attempt acquires anew", async () => {
    const adm = fakeAdmission();
    let attempts = 0;
    const heldDuringSleep: number[] = [];
    const reader = createRpcReader(adm.a, {
      connect: () => conn,
      now,
      random: () => 0,
      sleep: async (ms) => {
        heldDuringSleep.push(adm.held());
        clock += ms;
      },
    });
    await reader.read("getTransaction", async () => {
      if (++attempts < 3) throw new Error("429 Too Many Requests");
      return "ok";
    });
    expect(heldDuringSleep).toEqual([0, 0]);
    expect(adm.log).toEqual(["acquire:getTransaction", "release:getTransaction", "acquire:getTransaction", "release:getTransaction", "acquire:getTransaction", "release:getTransaction"]);
  });

  it("account reads do not consume transaction admission", async () => {
    const adm = fakeAdmission();
    const reader = createRpcReader(adm.a, { connect: () => conn, now, sleep });
    await reader.read("getAccountInfo", async () => null);
    await reader.read("getMultipleAccountsInfo", async () => []);
    expect(adm.log).toEqual([]);
  });

  it("concurrent callers stay within the local cap when the shared gate is unavailable", async () => {
    const shared = fakeAdmission({ failAcquire: true });
    const local = createLocalAdmission({ limit: 2 });
    let inFlight = 0;
    let peak = 0;
    const degraded = vi.fn();
    const reader = createRpcReader(shared.a, { connect: () => conn, now, sleep, localAdmission: local, onDegraded: degraded });
    const resolvers: Array<() => void> = [];
    const op = () =>
      new Promise<number>((resolve) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        resolvers.push(() => {
          inFlight--;
          resolve(1);
        });
      });
    const all = Promise.all(Array.from({ length: 6 }, () => reader.read("getTransaction", op)));
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 10; k++) await Promise.resolve();
      resolvers.shift()?.();
    }
    await all;
    expect(peak).toBe(2);
    expect(local.active()).toBe(0);
    expect(degraded).toHaveBeenCalled();
  });

  it("local admission rejects a queued waiter on caller abort", async () => {
    const local = createLocalAdmission({ limit: 1 });
    const l1 = await local.acquire("getTransaction", {});
    const ctrl = new AbortController();
    const p = local.acquire("getTransaction", { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
    await l1.release();
    expect(local.active()).toBe(0);
  });
});

describe("configuration and redaction", () => {
  it("missing live configuration fails explicitly, lazily", async () => {
    expect(() => readRpcConfig({})).toThrow(/RPC_URL is not set/);
    expect(() => readRpcConfig({ RPC_URL: "  " })).toThrow(/RPC_URL is not set/);
    expect(() => readRpcConfig({ RPC_URL: "ftp://x" })).toThrow(/not a valid/);
    // Building a reader does not read config or connect.
    const reader = createRpcReader(fakeAdmission().a, { env: {} });
    await expect(reader.read("getSlot", (c) => c.getSlot())).rejects.toMatchObject({ kind: "config", retryable: false });
  });

  it("module loading does not require RPC_URL or open a connection", async () => {
    const saved = process.env.RPC_URL;
    delete process.env.RPC_URL;
    vi.resetModules();
    const m = await import("@/server/rpc");
    expect(typeof m.rpc).toBe("function");
    expect(typeof m.createRpcReader).toBe("function");
    if (saved !== undefined) process.env.RPC_URL = saved;
  });

  it("public errors and logs do not expose the credential-bearing URL", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const adm = fakeAdmission();
    const reader = createRpcReader(adm.a, {
      connect: () => ({}) as Connection,
      now,
      sleep,
    });
    const err: RpcFailure = await reader
      .read("getSlot", async () => {
        throw new Error(`request to ${SECRET_URL} failed, reason: getaddrinfo ENOTFOUND`);
      })
      .catch((e) => e);
    expect(err.message).not.toContain("abc123secretkey");
    expect(err.message).not.toContain("hunter2");
    expect(err.message).not.toContain("rpc.example.invalid");
    const { toErrorResponse } = await import("@/server/errors");
    const res = toErrorResponse(err);
    const body = await res.text();
    expect(body).not.toContain("abc123secretkey");
    for (const call of errSpy.mock.calls) expect(JSON.stringify(call)).not.toContain("abc123secretkey");
    errSpy.mockRestore();
  });
});
