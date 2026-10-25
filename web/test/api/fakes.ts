// Test doubles: a fake Connection serving the reference-session fixtures, and
// fixture-backed stand-ins for the @macropaths/client view functions.
import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { ACCOUNT_DISCRIMINATORS, PROGRAM_ID, type EventView } from "@macropaths/client";
import sessionView from "@macropaths/client/fixtures/session-B89z.view.json";
import positionsView from "@macropaths/client/fixtures/positions-B89z.view.json";
import eventsView from "@macropaths/client/fixtures/events-B89z.view.json";
import children from "@macropaths/client/fixtures/children-B89z.raw.json";
import txlogs from "@macropaths/client/fixtures/txlogs-B89z.raw.json";

export const SESSION_A = "B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju";
const fixtures = path.resolve(__dirname, "../../../packages/client/fixtures");
export const sessionBytes = Buffer.from(readFileSync(path.join(fixtures, "session-B89z.base64"), "utf8").trim(), "base64");
export const txs = txlogs as { signature: string; slot: number; blockTime: number | null; logs: string[] }[];
export { sessionView, positionsView, eventsView };

const own = (data: Buffer) => ({ owner: PROGRAM_ID, data, executable: false, lamports: 1, rentEpoch: 0 });

export function makeFakeConnection() {
  return {
    getSlot: vi.fn(async () => 123456),
    getAccountInfo: vi.fn(async (key: PublicKey) => {
      if (key.equals(PROGRAM_ID)) return { ...own(Buffer.alloc(36)), executable: true, owner: new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111") };
      if (key.toBase58() === SESSION_A) return own(sessionBytes);
      return null;
    }),
    getProgramAccounts: vi.fn(async (_pid: PublicKey, cfg: { filters: { memcmp: { offset: number; bytes: string } }[] }) => {
      const m = cfg.filters[0].memcmp;
      if (m.offset === 0) return [{ pubkey: new PublicKey(SESSION_A), account: own(sessionBytes) }];
      if (m.bytes !== SESSION_A) return [];
      return children.map((c) => ({ pubkey: new PublicKey(c.address), account: own(Buffer.from(c.base64, "base64")) }));
    }),
    getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) => keys.map(() => null)),
    getSignaturesForAddress: vi.fn(async (_k: PublicKey, o: { before?: string; limit?: number }) => {
      const start = o.before ? txs.findIndex((t) => t.signature === o.before) + 1 : 0;
      return txs.slice(start, start + (o.limit ?? 1000)).map((t) => ({ signature: t.signature, slot: t.slot, blockTime: t.blockTime, err: null, memo: null }));
    }),
    getTransaction: vi.fn(async (sig: string) => {
      const t = txs.find((x) => x.signature === sig);
      return t ? { slot: t.slot, blockTime: t.blockTime, meta: { err: null, logMessages: t.logs } } : null;
    }),
  };
}

const same = (a: Uint8Array, b: Uint8Array) => a.length >= b.length && b.every((x, i) => a[i] === x);

/** Fixture-backed replacements for the client functions fe-01 implements. */
export const clientFakes = {
  accountKind: (data: Uint8Array) =>
    (Object.entries(ACCOUNT_DISCRIMINATORS).find(([, d]) => same(data, d))?.[0] ?? null) as never,
  toSessionView: (address: string) => ({ ...sessionView, address }) as never,
  toPositionView: (address: string) => ({ ...positionsView.positions[0], address }) as never,
  toCoverView: () => {
    throw new Error("fixture has no Cover");
  },
  toSellerView: () => {
    throw new Error("fixture has no Seller");
  },
  toEntryQuoteView: () => {
    throw new Error("fixture has no EntryQuote");
  },
  parseEvents: (_logs: string[], meta: { signature: string }) =>
    (eventsView.events as EventView[]).filter((e) => e.signature === meta.signature),
  sellerPda: () => [new PublicKey(new Uint8Array(32).fill(7)), 255] as never,
  quotePda: () => [new PublicKey(new Uint8Array(32).fill(9)), 255] as never,
};
