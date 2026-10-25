// Synthetic test data only (labelled); not on-chain state.
import { describe, expect, it } from "vitest";
import type { CoverView, PositionView, SessionView, WalletActivityItem, WalletOverviewResponse } from "@macropaths/client";
import {
  activityRows,
  amountLabel,
  amountText,
  balanceRows,
  buildHoldings,
  historicalRange,
  lastReading,
  replayStateText,
  scorePath,
  signedPlay,
  type SessionLookup,
} from "./model";

const OWNER = "Owner1111111111111111111111111111111111111";
const OTHER = "Other1111111111111111111111111111111111111";
const MINT_A = "MintA111111111111111111111111111111111111";
const MINT_B = "MintB111111111111111111111111111111111111";
const S1 = "Sess1111111111111111111111111111111111111";
const S2 = "Sess2222222222222222222222222222222222222";
const ADDR = "Acct1111111111111111111111111111111111111";
const HEX = "0".repeat(64);

function session(over: Partial<SessionView> = {}): SessionView {
  return {
    address: S1,
    sessionId: "1",
    authority: ADDR,
    playMint: MINT_A,
    vaults: [ADDR, ADDR],
    state: "Settled",
    datasetId: HEX,
    commitment: HEX,
    terminal: HEX,
    integrityOk: true,
    nObs: 3,
    nextIndex: 3,
    lastPeriodId: 202203,
    terms: { k: "40000", dCap: "80000", aCap: "800000" },
    depositDeadline: 0,
    replayDeadline: 0,
    sideTotals: ["100000000", "100000000", "100000000", "80000000"],
    matched: ["100000000", "80000000"],
    stats: { peak: "70000", maxDecline: "20000", excessAcc: "60000" },
    scores: ["250000", "75000"],
    pBudget: ["50000000", "150000000", "12000000", "148000000"],
    rBudget: ["0", "0", "20000000", "0"],
    counts: { positions: 1, claimed: 0, covers: 1, coversClaimed: 0, sellerProductsOpen: 0 },
    path: [
      { i: 0, periodId: 202201, value: "50000", peak: "50000", decline: "0", excess: "10000" },
      { i: 1, periodId: 202202, value: "70000", peak: "70000", decline: "0", excess: "40000" },
      { i: 2, periodId: 202203, value: "50000", peak: "70000", decline: "20000", excess: "60000" },
    ],
    ...over,
  };
}

const position = (over: Partial<PositionView> = {}): PositionView => ({
  address: ADDR,
  owner: OWNER,
  deposited: ["10000000", "10000000", "5000000", "5000000"],
  claimed: false,
  payout: ["5000000", "15000000", "6000000", "4000000"],
  ...over,
});
const cover = (over: Partial<CoverView> = {}): CoverView => ({
  address: ADDR,
  owner: OWNER,
  units: ["0", "100000000"],
  premiumPaid: ["0", "5715300"],
  claimed: false,
  payout: ["0", "7500000"],
  ...over,
});

function overview(holdings: WalletOverviewResponse["holdings"], balances?: WalletOverviewResponse["balances"]): WalletOverviewResponse {
  return {
    owner: OWNER,
    meta: { source: "fixture", fetchedAt: "2026-01-01T00:00:00Z" },
    balances: balances ?? [{ mint: MINT_A, read: { status: "ok", data: { amount: "123456789" } } }],
    holdings,
  };
}
const lookupFor = (...ss: SessionView[]): SessionLookup => (a) => {
  const s = ss.find((x) => x.address === a);
  return s ? { session: s, label: `Label ${a.slice(0, 5)}` } : null;
};

describe("balances", () => {
  it("keeps mints separate and never turns a failed read into zero", () => {
    const rows = balanceRows(
      overview([], [
        { mint: MINT_A, read: { status: "ok", data: { amount: "1500000" } } },
        { mint: MINT_B, read: { status: "unavailable", data: null } },
      ]),
    );
    expect(rows).toEqual([
      { mint: MINT_A, status: "ok", amount: "1500000", formatted: "1.50 PLAY" },
      { mint: MINT_B, status: "unavailable" },
    ]);
  });
});

describe("holdings", () => {
  it("separates covers and pool positions for the connected owner (mixed, Settled)", () => {
    const m = buildHoldings(overview([{ sessionAddress: S1, read: { status: "ok", data: { position: position(), cover: cover() } } }]), lookupFor(session()));
    expect(m.covers).toHaveLength(1);
    expect(m.positions).toHaveLength(1);
    expect(m.covers[0].products).toEqual(["Excess Inflation"]);
    expect(m.covers[0].premiumPaid).toBe("5715300");
    expect(m.covers[0].maximumPayout).toBe("100000000");
    expect(m.covers[0].summary.status).toBe("payout");
    expect(m.positions[0].totalDeposited).toBe("30000000");
    expect(m.positions[0].sides.map((s) => `${s.product}:${s.side}`)).toEqual([
      "Excess Inflation:More",
      "Excess Inflation:Less",
      "Inflation Cooling:More",
      "Inflation Cooling:Less",
    ]);
    expect(m.claimable).toEqual([{ mint: MINT_A, amount: "37500000" }]);
  });

  it("drops accounts owned by a different wallet (unrelated owner / owner switch)", () => {
    const m = buildHoldings(
      overview([{ sessionAddress: S1, read: { status: "ok", data: { position: position({ owner: OTHER }), cover: cover({ owner: OTHER }) } } }]),
      lookupFor(session()),
    );
    expect(m.covers).toEqual([]);
    expect(m.positions).toEqual([]);
    expect(m.claimable).toEqual([]);
  });

  it("reports a failed holdings read as unavailable, not empty", () => {
    const m = buildHoldings(overview([{ sessionAddress: S1, read: { status: "unavailable", data: null } }]), lookupFor(session()));
    expect(m.unavailable).toEqual([{ sessionAddress: S1, sessionLabel: "Label Sess1", reason: "read" }]);
    expect(m.claimable).toEqual([]);
  });

  it("claimed holdings stay visible but contribute zero", () => {
    const m = buildHoldings(
      overview([{ sessionAddress: S1, read: { status: "ok", data: { position: null, cover: cover({ claimed: true }) } } }]),
      lookupFor(session()),
    );
    expect(m.covers[0].summary.status).toBe("claimed");
    expect(m.claimable).toEqual([{ mint: MINT_A, amount: "0" }]);
    expect(amountLabel("claimed", false)).toBe("Claimed");
  });

  it("Refunding uses premiums/deposits and the Refund label", () => {
    const s = session({ state: "Refunding" });
    const m = buildHoldings(
      overview([{ sessionAddress: S1, read: { status: "ok", data: { position: null, cover: cover({ payout: ["0", "5715300"] }) } } }]),
      lookupFor(s),
    );
    expect(m.covers[0].summary.status).toBe("refund");
    expect(amountLabel(m.covers[0].summary.status, m.covers[0].refunding)).toBe("Refund available");
    expect(amountLabel("claimed", true)).toBe("Refunded");
  });

  it("Running is an illustration and excluded wording is distinct; Open is undetermined", () => {
    const running = buildHoldings(
      overview([{ sessionAddress: S1, read: { status: "ok", data: { position: null, cover: cover({ payout: null }) } } }]),
      lookupFor(session({ state: "Running" })),
    );
    expect(running.covers[0].summary.status).toBe("illustration");
    expect(amountLabel("illustration", false)).toBe("Accrued payout illustration");

    const open = buildHoldings(
      overview([{ sessionAddress: S1, read: { status: "ok", data: { position: null, cover: cover({ payout: null }) } } }]),
      lookupFor(session({ state: "Open", nextIndex: 0, path: [], stats: { peak: null, maxDecline: "0", excessAcc: "0" } })),
    );
    expect(open.covers[0].summary.status).toBe("undetermined");
    expect(amountText(open.covers[0].summary)).toBe("Not determined yet");
  });

  it("never sums different mints", () => {
    const m = buildHoldings(
      overview([
        { sessionAddress: S1, read: { status: "ok", data: { position: null, cover: cover() } } },
        { sessionAddress: S2, read: { status: "ok", data: { position: null, cover: cover() } } },
      ]),
      lookupFor(session(), session({ address: S2, playMint: MINT_B })),
    );
    expect(m.claimable).toEqual([
      { mint: MINT_A, amount: "7500000" },
      { mint: MINT_B, amount: "7500000" },
    ]);
  });
});

describe("session preview", () => {
  it("describes range, state and last replay reading", () => {
    const s = session();
    expect(historicalRange(s)).toBe("Jan 2022 – Mar 2022");
    expect(lastReading(s)).toEqual({ value: "50000", month: "Mar 2022" });
    expect(replayStateText(s)).toBe("Settled");
    expect(replayStateText(session({ state: "Running", nextIndex: 2 }))).toBe("Replaying · 2 of 3 readings");
    expect(lastReading(session({ path: [] }))).toBeNull();
  });
  it("derives product score paths from recorded statistics", () => {
    expect(scorePath(session(), 0).map((p) => p.score)).toEqual(["0", "0", "250000"]);
    expect(scorePath(session(), 1).map((p) => p.score)).toEqual(["12500", "50000", "75000"]);
  });
});

describe("activity", () => {
  const item = (over: Partial<WalletActivityItem>): WalletActivityItem => ({
    id: "sig:0:top:CoverBought",
    signature: "sig",
    instructionIndex: 0,
    innerInstructionIndex: null,
    session: S1,
    product: 1,
    slot: 1,
    blockTime: null,
    kind: "CoverBought",
    amount: "-5715300",
    mint: MINT_A,
    ...over,
  });
  it("signs amounts and labels unknown amounts", () => {
    expect(signedPlay("-5715300")).toEqual({ text: "-5.72 PLAY", direction: "out" });
    expect(signedPlay("7500000")).toEqual({ text: "+7.50 PLAY", direction: "in" });
    expect(signedPlay(null)).toEqual({ text: "Amount unavailable", direction: "unknown" });
  });
  it("is bounded and links to Explorer", () => {
    const rows = activityRows(
      Array.from({ length: 8 }, (_, i) => item({ id: `id${i}`, product: i % 2 === 0 ? null : 1 })),
      { limit: 5, cluster: "devnet", labelFor: () => "Session A" },
    );
    expect(rows).toHaveLength(5);
    expect(rows[0].context).toBe("Session A · Both products");
    expect(rows[0].when).toBe("Date unavailable");
    expect(rows[0].explorerUrl).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
  });
});
