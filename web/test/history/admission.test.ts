import { describe, expect, it } from "vitest";
import { AdmissionTimeout, createHistoryAdmission, LEASE_TTL_MS } from "@/server/history/admission";
import { MemoryCacheStore } from "@/server/history/store";
import { parseHistoryQuery } from "@/server/history/query";
import { normalizeTransaction } from "@/server/history/normalize";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("history admission", () => {
  it("allows at most two active getTransaction calls and passes other methods through", async () => {
    const adm = createHistoryAdmission(new MemoryCacheStore(), { sleep: () => tick() });
    const a = await adm.acquire("getTransaction", {});
    const b = await adm.acquire("getTransaction", {});
    await adm.acquire("getSignaturesForAddress", {}); // ungated
    let third = false;
    const p = adm.acquire("getTransaction", {}).then((l) => ((third = true), l));
    await tick();
    await tick();
    expect(third).toBe(false);
    await a.release();
    await (await p).release();
    expect(third).toBe(true);
    await b.release();
  });

  it("uses shared leases, releases only its own token, and frees on release", async () => {
    let t = 0;
    const store = new MemoryCacheStore(() => t);
    const one = createHistoryAdmission(store, { now: () => t, sleep: async () => void (t += 100) });
    const two = createHistoryAdmission(store, { now: () => t, sleep: async () => void (t += 100) });
    const a = await one.acquire("getTransaction", {});
    const b = await one.acquire("getTransaction", {});
    expect(store.keys().filter((k) => k.startsWith("lease:"))).toHaveLength(2);
    // Another instance cannot exceed the provider-wide limit before the deadline.
    await expect(two.acquire("getTransaction", { deadlineAt: t + 300 })).rejects.toBeInstanceOf(AdmissionTimeout);
    // After A's lease expires and is taken by another owner, A's late release must not delete it.
    t += LEASE_TTL_MS + 1;
    const c = await two.acquire("getTransaction", {});
    await a.release();
    await b.release();
    expect(store.keys().filter((k) => k.startsWith("lease:"))).toHaveLength(1);
    await c.release();
    expect(store.keys().filter((k) => k.startsWith("lease:"))).toHaveLength(0);
  });

  it("falls back to local admission when the lease store fails", async () => {
    const store = new MemoryCacheStore();
    store.tryLease = async () => {
      throw new Error("ECONNREFUSED");
    };
    store.get = async () => {
      throw new Error("ECONNREFUSED");
    };
    const adm = createHistoryAdmission(store, { sleep: () => tick() });
    const a = await adm.acquire("getTransaction", {});
    await adm.acquire("getTransaction", {});
    await expect(adm.acquire("getTransaction", { deadlineAt: Date.now() + 5 })).rejects.toBeInstanceOf(AdmissionTimeout);
    await a.release();
  });

  it("honours a shared cooldown but never sleeps past the deadline", async () => {
    let t = 0;
    const slept: number[] = [];
    const store = new MemoryCacheStore(() => t);
    const adm = createHistoryAdmission(store, { now: () => t, sleep: async (ms) => void (slept.push(ms), (t += ms)) });
    await adm.noteRateLimit("getTransaction", 2_000);
    const other = createHistoryAdmission(store, { now: () => t, sleep: async (ms) => void (slept.push(ms), (t += ms)) });
    await expect(other.acquire("getTransaction", { deadlineAt: 500 })).rejects.toBeInstanceOf(AdmissionTimeout);
    expect(slept).toEqual([500]);
    const l = await other.acquire("getTransaction", { deadlineAt: 10_000 });
    expect(t).toBeGreaterThanOrEqual(2_000);
    await l.release();
  });

  it("releases the local slot when the caller is aborted while waiting", async () => {
    const adm = createHistoryAdmission(new MemoryCacheStore(), { sleep: () => tick() });
    const a = await adm.acquire("getTransaction", {});
    const b = await adm.acquire("getTransaction", {});
    const ac = new AbortController();
    const waiting = adm.acquire("getTransaction", { signal: ac.signal });
    ac.abort();
    await expect(waiting).rejects.toBeInstanceOf(AdmissionTimeout);
    await a.release();
    await b.release();
    const c = await adm.acquire("getTransaction", {});
    const d = await adm.acquire("getTransaction", {});
    await c.release();
    await d.release();
  });
});

describe("history query parsing", () => {
  const q = (s: string) => parseHistoryQuery(new URLSearchParams(s));
  it("accepts before/limit or retryCursor alone", () => {
    expect(q("")).toEqual({});
    expect(q(`limit=25&before=${"5".repeat(87)}`)).toEqual({ limit: 25, before: "5".repeat(87) });
    expect(q(`retryCursor=${"a".repeat(32)}`)).toEqual({ retryCursor: "a".repeat(32) });
  });
  it.each(["limit=0", "limit=26", "limit=1.5", "limit=abc", "before=xyz", `retryCursor=${"a".repeat(32)}&limit=5`, "retryCursor=bad!"])(
    "rejects %s",
    (s) => expect(() => q(s)).toThrow(expect.objectContaining({ code: "bad_request" })),
  );
});

describe("normalizeTransaction", () => {
  const withInner = (inner: Array<{ stackHeight?: number }>) =>
    normalizeTransaction(
      "s",
      {
        slot: 1,
        transaction: { message: { staticAccountKeys: ["A", "P"], compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [], data: new Uint8Array() }] } },
        meta: { err: null, innerInstructions: [{ index: 0, instructions: inner.map((x) => ({ programIdIndex: 1, accounts: [], data: "", ...x })) }] },
      },
      "confirmed",
    );
  it("flags unresolved parentage only when stackHeight is missing in a multi-instruction group", () => {
    expect(withInner([{}]).parentageResolved).toBe(true);
    expect(withInner([{}, {}]).parentageResolved).toBe(false);
    expect(withInner([{ stackHeight: 2 }, { stackHeight: 2 }]).parentageResolved).toBe(true);
  });

  it("resolves v0 loaded keys, inner instruction parentage and token balances as strings", () => {
    const tx = normalizeTransaction(
      "s",
      {
        slot: 1,
        blockTime: null,
        transaction: { message: { staticAccountKeys: ["A", "P"], compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0, 2], data: new Uint8Array([9]) }] } },
        meta: {
          err: null,
          logMessages: ["l"],
          loadedAddresses: { writable: ["W"], readonly: ["R"] },
          innerInstructions: [
            {
              index: 0,
              instructions: [
                { programIdIndex: 3, accounts: [2], data: "2", stackHeight: 2 },
                { programIdIndex: 3, accounts: [0], data: "2", stackHeight: 3 },
              ],
            },
          ],
          preTokenBalances: [{ accountIndex: 2, mint: "M", owner: "A", uiTokenAmount: { amount: "18446744073709551615" } }],
          postTokenBalances: [{ accountIndex: 2, mint: "M", owner: "A", uiTokenAmount: { amount: "0" } }],
        },
      },
      "finalized",
    );
    expect(tx.accountKeys).toEqual(["A", "P", "W", "R"]);
    expect(tx.instructions.map((i) => [i.instructionIndex, i.innerInstructionIndex, i.parentInnerInstructionIndex, i.programId])).toEqual([
      [0, null, null, "P"],
      [0, 0, null, "R"],
      [0, 1, 0, "R"],
    ]);
    expect(tx.parentageResolved).toBe(true);
    expect(tx.tokenBalances).toEqual([{ accountIndex: 2, mint: "M", owner: "A", preAmount: "18446744073709551615", postAmount: "0" }]);
  });
});
