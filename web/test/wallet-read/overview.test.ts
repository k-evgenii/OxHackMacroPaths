// Wallet read service: direct PDA reads, integrity validation, exact balances, partial states.
import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import * as client from "@macropaths/client";
import { ACCOUNT_DISCRIMINATORS, PROGRAM_ID, coverPda, positionPda, type SessionView } from "@macropaths/client";
import sessionFixture from "@macropaths/client/fixtures/session-B89z.view.json";
import {
  TOKEN_PROGRAM_ID,
  fixtureWalletOverview,
  getWalletOverview,
  readWalletOverview,
  type TokenAccountRead,
  type WalletOverviewDeps,
} from "@/server/wallet/overview";
import { HttpError } from "@/server/errors";

const OWNER = new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
const OTHER = new PublicKey("7cVfgArCheMR6Cs4t2vz7Ji5vjEdcvq8JmS6s2RVCGKx");
const MINT_A = new PublicKey((sessionFixture as SessionView).playMint);
const MINT_B = Keypair.generate().publicKey;
const base = sessionFixture as SessionView;
const S1: SessionView = { ...base, address: Keypair.generate().publicKey.toBase58() };
const S2: SessionView = { ...base, address: Keypair.generate().publicKey.toBase58(), playMint: MINT_B.toBase58() };

const acct = (owner: PublicKey, data: Buffer): AccountInfo<Buffer> => ({ owner, data, executable: false, lamports: 1, rentEpoch: 0 });
// Borsh layout from the IDL: disc(8) session(32) owner(32) u64[] claimed(u8) bump(u8).
function encode(kind: "Position" | "Cover", session: string, owner: PublicKey, nums: string[], claimed: boolean): Buffer {
  const d = Buffer.alloc(8 + 64 + nums.length * 8 + 2);
  Buffer.from(ACCOUNT_DISCRIMINATORS[kind]).copy(d, 0);
  new PublicKey(session).toBuffer().copy(d, 8);
  owner.toBuffer().copy(d, 40);
  nums.forEach((n, i) => d.writeBigUInt64LE(BigInt(n), 72 + 8 * i));
  d[72 + nums.length * 8] = claimed ? 1 : 0;
  d[73 + nums.length * 8] = 255;
  return d;
}
async function positionData(session: string, owner: PublicKey, deposited = ["5000000", "0", "0", "7000000"], claimed = false) {
  return encode("Position", session, owner, deposited, claimed);
}
async function coverData(session: string, owner: PublicKey, units = ["3000000", "1000000"], claimed = false) {
  return encode("Cover", session, owner, [...units, "100000", "50000"], claimed);
}

function tokenAccount(mint: PublicKey, owner: PublicKey, amount: bigint, program = TOKEN_PROGRAM_ID): TokenAccountRead {
  const d = Buffer.alloc(165);
  mint.toBuffer().copy(d, 0);
  owner.toBuffer().copy(d, 32);
  d.writeBigUInt64LE(amount, 64);
  d[108] = 1;
  return { pubkey: Keypair.generate().publicKey, account: acct(program, d) };
}

type Store = Map<string, AccountInfo<Buffer>>;
function deps(sessions: SessionView[], store: Store, tokens: Record<string, TokenAccountRead[] | Error> = {}, extra: Partial<WalletOverviewDeps> = {}) {
  const getManyAccounts = vi.fn(async (keys: readonly PublicKey[]) => keys.map((k) => store.get(k.toBase58()) ?? null));
  const tokenAccounts = vi.fn(async (o: PublicKey, mint: PublicKey) => {
    const t = tokens[mint.toBase58()] ?? [];
    if (t instanceof Error) throw t;
    // RPC returns only accounts of this owner; keep deliberately-wrong owners for integrity tests.
    return o.equals(OWNER) ? t : t.filter((a) => new PublicKey(a.account.data.subarray(32, 64)).equals(o));
  });
  const d: WalletOverviewDeps = {
    sessions: { listRegistered: vi.fn(async () => sessions), getManyAccounts },
    tokenAccounts,
    cluster: "devnet",
    now: () => new Date("2026-01-01T00:00:00Z"),
    warn: () => {},
    ...extra,
  };
  return { d, getManyAccounts, tokenAccounts };
}
const pda = (kind: "position" | "cover", s: SessionView, o = OWNER) =>
  (kind === "position" ? positionPda : coverPda)(new PublicKey(s.address), o)[0].toBase58();

describe("readWalletOverview", () => {
  it("rejects a malformed owner with a typed 400", async () => {
    const { d } = deps([S1], new Map());
    await expect(readWalletOverview("not-a-key", d)).rejects.toMatchObject({ code: "bad_request" });
    await expect(getWalletOverview("0OIl")).rejects.toBeInstanceOf(HttpError);
  });

  it("returns a successful empty/zero state for a wallet with nothing", async () => {
    const { d } = deps([S1, S2], new Map());
    const r = await readWalletOverview(OWNER.toBase58(), d);
    expect(r).toEqual({
      owner: OWNER.toBase58(),
      meta: { source: "rpc", fetchedAt: "2026-01-01T00:00:00.000Z" },
      balances: [
        { mint: MINT_A.toBase58(), read: { status: "ok", data: { amount: "0" } } },
        { mint: MINT_B.toBase58(), read: { status: "ok", data: { amount: "0" } } },
      ],
      holdings: [
        { sessionAddress: S1.address, read: { status: "ok", data: { position: null, cover: null } } },
        { sessionAddress: S2.address, read: { status: "ok", data: { position: null, cover: null } } },
      ],
    });
  });

  it("reads exactly the derived Position/Cover PDAs, no program scans", async () => {
    const { d, getManyAccounts } = deps([S1, S2], new Map());
    await readWalletOverview(OWNER.toBase58(), d);
    expect(getManyAccounts).toHaveBeenCalledTimes(1);
    const keys = getManyAccounts.mock.calls[0][0].map((k) => k.toBase58());
    expect(keys).toEqual([pda("position", S1), pda("cover", S1), pda("position", S2), pda("cover", S2)]);
    expect(Object.keys(d.sessions)).not.toContain("getProgramAccounts");
  });

  it("batches large registries at <=100 keys per read", async () => {
    const many = Array.from({ length: 120 }, () => ({ ...base, address: Keypair.generate().publicKey.toBase58() }));
    const { d, getManyAccounts } = deps(many, new Map());
    const r = await readWalletOverview(OWNER.toBase58(), d);
    expect(getManyAccounts.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 40]);
    expect(r.holdings.every((h) => h.read.status === "ok")).toBe(true);
  });

  it("converts valid accounts with the shared view helpers (Settled payouts)", async () => {
    const store: Store = new Map([
      [pda("position", S1), acct(PROGRAM_ID, await positionData(S1.address, OWNER))],
      [pda("cover", S1), acct(PROGRAM_ID, await coverData(S1.address, OWNER))],
    ]);
    const { d } = deps([S1], store);
    const h = (await readWalletOverview(OWNER.toBase58(), d)).holdings[0].read;
    expect(h.status).toBe("ok");
    const data = h.data!;
    expect(data.position).toMatchObject({ address: pda("position", S1), owner: OWNER.toBase58(), deposited: ["5000000", "0", "0", "7000000"] });
    const exp = client.claimAmount(5000000n, BigInt(base.rBudget[0]), BigInt(base.pBudget[0]), BigInt(base.sideTotals[0]));
    expect(data.position!.payout![0]).toBe(exp.toString());
    expect(data.cover!.payout).toEqual([
      client.coverPayout(BigInt(base.scores[0]), 3000000n).toString(),
      client.coverPayout(BigInt(base.scores[1]), 1000000n).toString(),
    ]);
  });

  it("Running has null payouts and Refunding pays back deposits/premiums", async () => {
    const run: SessionView = { ...S1, state: "Running" };
    const ref: SessionView = { ...S2, playMint: S1.playMint, state: "Refunding" };
    const store: Store = new Map([
      [pda("position", run), acct(PROGRAM_ID, await positionData(run.address, OWNER))],
      [pda("cover", ref), acct(PROGRAM_ID, await coverData(ref.address, OWNER))],
    ]);
    const r = await readWalletOverview(OWNER.toBase58(), deps([run, ref], store).d);
    expect(r.holdings[0].read.data!.position!.payout).toBeNull();
    expect(r.holdings[1].read.data!.cover!.payout).toEqual(["100000", "50000"]);
  });

  it.each([
    ["foreign program", async () => acct(TOKEN_PROGRAM_ID, await positionData(S1.address, OWNER))],
    ["wrong discriminator", async () => acct(PROGRAM_ID, await coverData(S1.address, OWNER))],
    ["wrong embedded owner", async () => acct(PROGRAM_ID, await positionData(S1.address, OTHER))],
    ["wrong embedded session", async () => acct(PROGRAM_ID, await positionData(S2.address, OWNER))],
  ])("rejects %s as unavailable, not absent", async (_n, make) => {
    const store: Store = new Map([[pda("position", S1), await make()]]);
    const warn = vi.fn();
    const r = await readWalletOverview(OWNER.toBase58(), deps([S1, S2], store, {}, { warn }).d);
    expect(r.holdings[0].read).toEqual({ status: "unavailable", data: null });
    expect(r.holdings[1].read.status).toBe("ok");
    expect(warn).toHaveBeenCalled();
  });

  it("a failed account read is unavailable, never an invented null holding", async () => {
    const { d } = deps([S1], new Map());
    (d.sessions.getManyAccounts as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("429"));
    const r = await readWalletOverview(OWNER.toBase58(), d);
    expect(r.holdings).toEqual([{ sessionAddress: S1.address, read: { status: "unavailable", data: null } }]);
    expect(r.balances[0].read.status).toBe("ok");
  });

  it("sums every standard token account of a mint exactly, beyond safe integers", async () => {
    const big = 2n ** 63n + 12345n;
    const r = await readWalletOverview(
      OWNER.toBase58(),
      deps([S1], new Map(), {
        [MINT_A.toBase58()]: [tokenAccount(MINT_A, OWNER, big), tokenAccount(MINT_A, OWNER, 3n), tokenAccount(MINT_A, OWNER, 9n, Keypair.generate().publicKey)],
      }).d,
    );
    expect(r.balances[0].read).toEqual({ status: "ok", data: { amount: (big + 3n).toString() } });
  });

  it("keeps distinct mints separate", async () => {
    const r = await readWalletOverview(
      OWNER.toBase58(),
      deps([S1, S2], new Map(), {
        [MINT_A.toBase58()]: [tokenAccount(MINT_A, OWNER, 10n)],
        [MINT_B.toBase58()]: [tokenAccount(MINT_B, OWNER, 20n)],
      }).d,
    );
    expect(r.balances.map((b) => [b.mint, b.read.data?.amount])).toEqual([
      [MINT_A.toBase58(), "10"],
      [MINT_B.toBase58(), "20"],
    ]);
  });

  it("a failed balance read is unavailable, not zero, and does not erase other sections", async () => {
    const r = await readWalletOverview(
      OWNER.toBase58(),
      deps([S1, S2], new Map(), { [MINT_A.toBase58()]: new Error("rpc down"), [MINT_B.toBase58()]: [tokenAccount(MINT_B, OWNER, 7n)] }).d,
    );
    expect(r.balances[0].read).toEqual({ status: "unavailable", data: null });
    expect(r.balances[1].read.data).toEqual({ amount: "7" });
    expect(r.holdings.every((h) => h.read.status === "ok")).toBe(true);
  });

  it("a token account for another owner or mint is an integrity failure, not counted", async () => {
    const r = await readWalletOverview(OWNER.toBase58(), deps([S1], new Map(), { [MINT_A.toBase58()]: [tokenAccount(MINT_A, OTHER, 5n)] }).d);
    expect(r.balances[0].read.status).toBe("unavailable");
  });

  it("registry failure is an endpoint error", async () => {
    const { d } = deps([], new Map());
    (d.sessions.listRegistered as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("registry"));
    await expect(readWalletOverview(OWNER.toBase58(), d)).rejects.toThrow("registry");
  });

  it("claimed holdings keep history but contribute nothing unclaimed", async () => {
    const store: Store = new Map([
      [pda("position", S1), acct(PROGRAM_ID, await positionData(S1.address, OWNER, undefined, true))],
      [pda("cover", S1), acct(PROGRAM_ID, await coverData(S1.address, OWNER, undefined, true))],
    ]);
    const h = (await readWalletOverview(OWNER.toBase58(), deps([S1], store).d)).holdings[0].read.data!;
    expect(h.position!.claimed).toBe(true);
    expect(h.position!.deposited).toEqual(["5000000", "0", "0", "7000000"]);
    expect(h.cover!.payout).not.toBeNull();
    const summarize = (client as Record<string, unknown>).summarizeHolding as
      | ((s: SessionView, p: unknown, c: unknown) => { unclaimedTotal: string | null })
      | undefined;
    if (summarize) expect(summarize(S1, h.position, h.cover).unclaimedTotal).toBe("0");
  });

  it("cache entries are scoped by owner and never leak across wallets", async () => {
    const mem = new Map<string, unknown>();
    const cache = { get: async <T,>(k: string) => (mem.get(k) as T) ?? null, set: async <T,>(k: string, v: T) => void mem.set(k, v) };
    const store: Store = new Map([[pda("position", S1), acct(PROGRAM_ID, await positionData(S1.address, OWNER))]]);
    const { d } = deps([S1], store, { [MINT_A.toBase58()]: [tokenAccount(MINT_A, OWNER, 99n)] }, { cache });
    const a = await readWalletOverview(OWNER.toBase58(), d);
    const b = await readWalletOverview(OTHER.toBase58(), d);
    expect(a.holdings[0].read.data!.position).not.toBeNull();
    expect(b.holdings[0].read.data).toEqual({ position: null, cover: null });
    expect(b.balances[0].read.data).toEqual({ amount: "0" });
    expect([...mem.keys()].every((k) => k.startsWith("wallet:v1:devnet:"))).toBe(true);
    // second read for OWNER is served from its own cache entries
    const again = await readWalletOverview(OWNER.toBase58(), d);
    expect(again.balances[0].read.data).toEqual({ amount: "99" });
  });
});

describe("fixtureWalletOverview", () => {
  const fixture = {
    owner: OWNER.toBase58(),
    meta: { source: "fixture" as const, fetchedAt: "x" },
    balances: [{ mint: MINT_A.toBase58(), read: { status: "ok" as const, data: { amount: "123" } } }],
    holdings: [{ sessionAddress: S1.address, read: { status: "ok" as const, data: { position: null, cover: null } } }],
  };
  it("serves the fixture owner its fixture", () => {
    expect(fixtureWalletOverview(OWNER.toBase58(), [fixture]).balances[0].read.data).toEqual({ amount: "123" });
  });
  it("never gives another owner the fixture owner's holdings", () => {
    const r = fixtureWalletOverview(OTHER.toBase58(), [fixture]);
    expect(r.owner).toBe(OTHER.toBase58());
    expect(r.balances[0].read.data).toEqual({ amount: "0" });
    expect(r.meta.source).toBe("fixture");
  });
});
