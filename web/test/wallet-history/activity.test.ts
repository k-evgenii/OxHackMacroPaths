import { describe, expect, it, vi } from "vitest";
import { createWalletActivity } from "@/server/wallet/activity";
import type { HistoryPage, HistoryPageRequest, TransactionRepository } from "@/server/wallet/decode/ports";
import { OWNER_TA, SESSION, VAULT0, WALLET, claimIx, depositIx, session, sig, transferIx, tx } from "./builders";

function repo(pages: (req: HistoryPageRequest) => HistoryPage) {
  const page = vi.fn(async (_scope, req: HistoryPageRequest) => pages(req));
  return { repo: { page } as TransactionRepository, page };
}
const listSessions = async () => [session({ state: "Settled" })];

describe("getWalletActivity service", () => {
  it("uses the wallet scope, default limit 10 and a 20 s deadline", async () => {
    const { repo: transactions, page } = repo(() => ({ transactions: [], nextBefore: null, pending: [], retryCursor: null }));
    const svc = createWalletActivity({ transactions, listSessions, now: () => 1000 });
    await svc(WALLET, {});
    expect(page).toHaveBeenCalledWith({ kind: "wallet", address: WALLET }, { before: undefined, limit: 10 }, { deadlineAt: 21_000 });
  });

  it("rejects limits outside 1..25", async () => {
    const { repo: transactions } = repo(() => ({ transactions: [], nextBefore: null, pending: [], retryCursor: null }));
    const svc = createWalletActivity({ transactions, listSessions });
    await expect(svc(WALLET, { limit: 26 })).rejects.toThrow();
    await expect(svc(WALLET, { limit: 0 })).rejects.toThrow();
  });

  it("an empty decoded page still paginates and reports pending/retry metadata", async () => {
    const next = sig(900);
    const { repo: transactions } = repo(() => ({
      transactions: [tx([transferIx({ ix: 0 }, OWNER_TA, VAULT0, WALLET, 1n)])],
      nextBefore: next,
      pending: [sig(901)],
      retryCursor: "tok",
    }));
    const res = await createWalletActivity({ transactions, listSessions })(WALLET, {});
    expect(res).toEqual({ items: [], nextBefore: next, pending: [sig(901)], retryCursor: "tok" });
  });

  it("Redis-unavailable truth (pending without cursor) is passed through", async () => {
    const { repo: transactions } = repo(() => ({ transactions: [], nextBefore: null, pending: [sig(902)], retryCursor: null }));
    const res = await createWalletActivity({ transactions, listSessions })(WALLET, {});
    expect(res).toMatchObject({ pending: [sig(902)], retryCursor: null });
  });

  it("retry passes only the cursor and returns the complete page with stable IDs", async () => {
    const s = sig(903);
    const claimTx = tx([claimIx({ ix: 0 }, "claim_cover"), transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 7n)], { signature: s });
    const depTx = tx([depositIx({ ix: 0 }, [0n, 0n, 0n, 0n])]);
    const { repo: transactions, page } = repo((req) =>
      req.retryCursor
        ? { transactions: [claimTx, depTx], nextBefore: "n", pending: [], retryCursor: null }
        : { transactions: [claimTx], nextBefore: "n", pending: [depTx.signature], retryCursor: "tok" },
    );
    const svc = createWalletActivity({ transactions, listSessions });
    const first = await svc(WALLET, { limit: 5 });
    const retry = await svc(WALLET, { retryCursor: "tok", limit: 5, before: "x" });
    expect(page.mock.calls[1][1]).toEqual({ retryCursor: "tok" });
    expect(retry.items[0].id).toBe(first.items[0].id);
    expect(retry.items.map((i) => i.id)).toContain(first.items[0].id);
    expect(retry.nextBefore).toBe("n");
  });

  it("deduplicates by action ID, not signature", async () => {
    const s = sig(904);
    const t = tx(
      [
        claimIx({ ix: 0 }, "claim_cover"),
        transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 1n),
        claimIx({ ix: 1 }, "claim"),
        transferIx({ ix: 1, inner: 0 }, VAULT0, OWNER_TA, SESSION, 2n),
      ],
      { signature: s },
    );
    const { repo: transactions } = repo(() => ({ transactions: [t, t], nextBefore: null, pending: [], retryCursor: null }));
    const res = await createWalletActivity({ transactions, listSessions })(WALLET, {});
    expect(res.items).toHaveLength(2);
    expect(res.items.every((i) => i.signature === s)).toBe(true);
  });
});
