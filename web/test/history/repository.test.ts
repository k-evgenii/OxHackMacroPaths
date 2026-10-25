import { describe, expect, it } from "vitest";
import { createTransactionRepository, txCacheKey } from "@/server/history/repository";
import { MemoryCacheStore } from "@/server/history/store";
import { eventsForSession, eventId, getSessionEventsPage } from "@/server/history/events";
import type { LeaseStore } from "@/server/history/types";
import { HttpError } from "@/server/errors";
import { FakeChain, OWNER, PID, SESSION_A, SESSION_B, claimedLog, programLogs, sig } from "./helpers";

/** Memory store pretending to be shared (Redis) so retry cursors are issued. */
class SharedMemoryStore extends MemoryCacheStore {
  override readonly shared = true as never;
}
const scope = { kind: "session" as const, address: SESSION_A };

function chainWith(n: number) {
  const chain = new FakeChain();
  for (let i = 1; i <= n; i++) chain.add(sig(i), programLogs(claimedLog(SESSION_A, OWNER, BigInt(i))));
  return chain;
}
const setup = (chain: FakeChain, store: LeaseStore = new SharedMemoryStore(), opts = {}) =>
  createTransactionRepository(chain.reader(), store, { cluster: "devnet", programId: PID, ...opts });

describe("transaction repository pages", () => {
  it("defaults to ten scanned signatures with nextBefore from the last scanned one", async () => {
    const chain = chainWith(30);
    const page = await setup(chain).page(scope, {});
    expect(page.transactions.map((t) => t.signature)).toEqual(chain.signatures.slice(0, 10).map((s) => s.signature));
    expect(page.nextBefore).toBe(sig(10));
    expect(page).toMatchObject({ pending: [], retryCursor: null });
  });

  it("rejects limits above 25 and retry combined with before/limit", async () => {
    const repo = setup(chainWith(1));
    await expect(repo.page(scope, { limit: 26 })).rejects.toBeInstanceOf(HttpError);
    await expect(repo.page(scope, { limit: 5, retryCursor: "a".repeat(32) })).rejects.toThrow(/cannot be combined/);
  });

  it("page with no relevant events still has nextBefore", async () => {
    const chain = new FakeChain();
    for (let i = 1; i <= 3; i++) chain.add(sig(i), programLogs(claimedLog(SESSION_B, OWNER)));
    const page = await getSessionEventsPage(setup(chain), SESSION_A, { limit: 3 });
    expect(page.events).toEqual([]);
    expect(page.nextBefore).toBe(sig(3));
  });

  it("one failed transaction returns the other transactions plus pending", async () => {
    const chain = chainWith(3);
    chain.behavior.set(sig(2), "error");
    const page = await setup(chain).page(scope, { limit: 3 });
    expect(page.transactions.map((t) => t.signature)).toEqual([sig(1), sig(3)]);
    expect(page.pending).toEqual([sig(2)]);
    expect(page.retryCursor).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
  });

  it("fully throttled hydration is a partial page, not an error", async () => {
    const chain = chainWith(3);
    for (let i = 1; i <= 3; i++) chain.behavior.set(sig(i), "error");
    const page = await setup(chain).page(scope, { limit: 3 });
    expect(page.transactions).toEqual([]);
    expect(page.pending).toEqual([sig(1), sig(2), sig(3)]);
    expect(page.nextBefore).toBe(sig(3));
  });

  it("signature enumeration failure is a whole-request error", async () => {
    const chain = chainWith(3);
    chain.sigListFails = true;
    await expect(setup(chain).page(scope, {})).rejects.toThrow(/429/);
  });

  it("null transaction stays pending and is not cached", async () => {
    const chain = chainWith(1);
    chain.behavior.set(sig(1), "null");
    const store = new SharedMemoryStore();
    const page = await setup(chain, store).page(scope, {});
    expect(page.pending).toEqual([sig(1)]);
    expect(await store.get(txCacheKey("devnet", PID, sig(1)))).toBeNull();
  });

  it("finalized failed transaction is a known read with no events", async () => {
    const chain = chainWith(1);
    chain.behavior.set(sig(1), "failed");
    const page = await setup(chain).page(scope, {});
    expect(page.pending).toEqual([]);
    expect(page.transactions[0].failed).toBe(true);
    expect(eventsForSession(page.transactions[0], SESSION_A)).toEqual([]);
  });
});

describe("retry cursors", () => {
  it("recovers the original page after new head signatures arrive, without re-enumerating", async () => {
    const chain = chainWith(5);
    chain.behavior.set(sig(2), "error");
    const store = new SharedMemoryStore();
    const repo = setup(chain, store);
    const first = await repo.page(scope, { limit: 3 });
    expect(first.pending).toEqual([sig(2)]);

    chain.prepend(sig(99), programLogs(claimedLog(SESSION_A, OWNER)));
    chain.behavior.set(sig(2), "ok");
    const enumerations = chain.calls.getSignaturesForAddress;
    const fetched = chain.calls.getTransaction.length;
    const retry = await repo.page(scope, { retryCursor: first.retryCursor! });

    expect(chain.calls.getSignaturesForAddress).toBe(enumerations);
    expect(chain.calls.getTransaction.slice(fetched)).toEqual([sig(2)]); // only unresolved
    expect(retry.transactions.map((t) => t.signature)).toEqual([sig(1), sig(2), sig(3)]);
    expect(retry).toMatchObject({ pending: [], retryCursor: null, nextBefore: first.nextBefore });
  });

  it("keeps resolved rows for the snapshot's lifetime even after the confirmed cache expires", async () => {
    let t = 1_000_000;
    const now = () => t;
    const chain = new FakeChain();
    chain.add(sig(1), programLogs(claimedLog(SESSION_A, OWNER)), "confirmed");
    chain.add(sig(2), programLogs(claimedLog(SESSION_A, OWNER)), "confirmed");
    chain.behavior.set(sig(2), "error");
    const store = new SharedMemoryStore(now);
    const repo = setup(chain, store, { now });
    const first = await repo.page(scope, { limit: 2 });
    t += 120_000; // confirmed cache TTL (30 s) elapsed
    chain.behavior.set(sig(1), "error");
    const retry = await repo.page(scope, { retryCursor: first.retryCursor! });
    expect(retry.transactions.map((x) => x.signature)).toEqual([sig(1)]);
    expect(retry.pending).toEqual([sig(2)]);
    expect(retry.retryCursor).toBe(first.retryCursor);
  });

  it("loading older pages does not invalidate an earlier page's cursor", async () => {
    const chain = chainWith(6);
    chain.behavior.set(sig(1), "error");
    const repo = setup(chain);
    const p1 = await repo.page(scope, { limit: 3 });
    const p2 = await repo.page(scope, { before: p1.nextBefore!, limit: 3 });
    expect(p2.transactions.map((x) => x.signature)).toEqual([sig(4), sig(5), sig(6)]);
    chain.behavior.set(sig(1), "ok");
    const r = await repo.page(scope, { retryCursor: p1.retryCursor! });
    expect(r.transactions.map((x) => x.signature)).toEqual([sig(1), sig(2), sig(3)]);
  });

  it("rejects foreign-scope, unknown and expired cursors with 400", async () => {
    let t = 0;
    const now = () => t;
    const chain = chainWith(2);
    chain.behavior.set(sig(1), "error");
    const store = new SharedMemoryStore(now);
    const repo = setup(chain, store, { now });
    const { retryCursor } = await repo.page(scope, {});
    const bad = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "bad_request" });
    await bad(repo.page({ kind: "session", address: SESSION_B }, { retryCursor: retryCursor! }));
    await bad(repo.page({ kind: "wallet", address: SESSION_A }, { retryCursor: retryCursor! }));
    await bad(repo.page(scope, { retryCursor: "Z".repeat(32) }));
    t += 15 * 60_000 + 1;
    await bad(repo.page(scope, { retryCursor: retryCursor! }));
  });

  it("issues no retry cursor when the store is not shared (Redis unavailable)", async () => {
    const chain = chainWith(2);
    chain.behavior.set(sig(1), "error");
    const page = await setup(chain, new MemoryCacheStore()).page(scope, {});
    expect(page).toMatchObject({ pending: [sig(1)], retryCursor: null });
  });

  it("issues no retry cursor when the shared store write fails", async () => {
    const chain = chainWith(2);
    chain.behavior.set(sig(1), "error");
    const store = new SharedMemoryStore();
    store.set = async () => {
      throw new Error("ECONNREFUSED");
    };
    store.get = async () => {
      throw new Error("ECONNREFUSED");
    };
    const page = await setup(chain, store).page(scope, {});
    expect(page.transactions.map((x) => x.signature)).toEqual([sig(2)]);
    expect(page).toMatchObject({ pending: [sig(1)], retryCursor: null });
  });
});

describe("cache and finality", () => {
  it("finalized cache hits avoid RPC; confirmed reads expire", async () => {
    let t = 0;
    const now = () => t;
    const chain = new FakeChain();
    chain.add(sig(1), programLogs(), "finalized");
    chain.add(sig(2), programLogs(), "confirmed");
    const store = new SharedMemoryStore(now);
    const repo = setup(chain, store, { now });
    await repo.page(scope, {});
    expect(chain.calls.getTransaction).toEqual([sig(1), sig(2)]);
    t += 60_000;
    await repo.page(scope, {});
    expect(chain.calls.getTransaction).toEqual([sig(1), sig(2), sig(2)]);
    t += 89 * 24 * 3600_000;
    await repo.page(scope, {});
    expect(chain.calls.getTransaction.filter((s) => s === sig(1))).toHaveLength(1);
  });

  it("deduplicates concurrent loads of the same signature", async () => {
    const chain = chainWith(3);
    const repo = setup(chain);
    await Promise.all([repo.page(scope, {}), repo.page(scope, {}), repo.page({ kind: "wallet", address: OWNER }, {})]);
    expect(chain.calls.getTransaction.sort()).toEqual([sig(1), sig(2), sig(3)].sort());
  });

  it("stores the normalized representation with exact string amounts and resolved keys", async () => {
    const chain = chainWith(1);
    const store = new SharedMemoryStore();
    await setup(chain, store).page(scope, {});
    const cached = await store.get<Record<string, unknown>>(txCacheKey("devnet", PID, sig(1)));
    expect(cached).toMatchObject({ signature: sig(1), finality: "finalized", failed: false, accountKeys: [OWNER, PID] });
    expect((cached as { instructions: unknown[] }).instructions[0]).toEqual({
      instructionIndex: 0,
      innerInstructionIndex: null,
      parentInnerInstructionIndex: null,
      programId: PID,
      accounts: [OWNER],
      dataBase64: Buffer.from([1, 2, 3]).toString("base64"),
    });
  });
});

describe("budget", () => {
  it("returns unresolved signatures at the deadline and cancels outstanding reads", async () => {
    const chain = chainWith(4);
    chain.behavior.set(sig(2), "hang");
    chain.behavior.set(sig(3), "hang");
    const repo = setup(chain, new SharedMemoryStore(), { budgetMs: 50, concurrency: 2 });
    const page = await repo.page(scope, {});
    expect(page.transactions.map((x) => x.signature)).toEqual([sig(1)]);
    expect(page.pending).toEqual([sig(2), sig(3), sig(4)]);
    expect(chain.aborted.sort()).toEqual([sig(2), sig(3)]);
    expect(chain.calls.getTransaction).not.toContain(sig(4));
  });
});

describe("session events", () => {
  it("filters multi-session transactions and keeps distinct stable event IDs", async () => {
    const chain = new FakeChain();
    chain.add(sig(1), programLogs(claimedLog(SESSION_B, OWNER), claimedLog(SESSION_A, OWNER, 5n), claimedLog(SESSION_A, OWNER, 6n)));
    const page = await getSessionEventsPage(setup(chain), SESSION_A, {});
    expect(page.events.map((e) => [e.session, e.eventIndex])).toEqual([
      [SESSION_A, 1],
      [SESSION_A, 2],
    ]);
    expect(new Set(page.events.map(eventId)).size).toBe(2);
    expect(page.events.map((e) => (e.data as { amounts: string[] }).amounts[0])).toEqual(["5", "6"]);
  });
});
