import { describe, expect, it } from "vitest";
import {
  buildFeed,
  classifyFeedError,
  formatSignedAmount,
  groupByDay,
  marketRows,
  marketSummary,
  type SessionLike,
  type WalletActivityItemLike,
  type WalletActivityPageLike,
} from "./model";

const SIG_A = "5".repeat(88);
const SIG_B = "4".repeat(88);

function item(over: Partial<WalletActivityItemLike> & { signature?: string } = {}): WalletActivityItemLike {
  const base = {
    signature: SIG_A,
    instructionIndex: 0,
    innerInstructionIndex: null,
    session: "Sess1111111111111111111111111111111111111",
    product: 0 as const,
    slot: 100,
    blockTime: 1_700_000_000,
    kind: "CoverBought" as const,
    amount: "-1000000",
    mint: "Mint111111111111111111111111111111111111",
    ...over,
  };
  return { ...base, id: over.id ?? `${base.signature}:${base.instructionIndex}:${base.innerInstructionIndex ?? "top"}:${base.kind}` };
}
const page = (items: WalletActivityItemLike[], over: Partial<WalletActivityPageLike> = {}): WalletActivityPageLike => ({
  nextBefore: null,
  pending: [],
  retryCursor: null,
  items,
  ...over,
});

describe("amounts", () => {
  it("formats signed exact PLAY and keeps null unavailable", () => {
    expect(formatSignedAmount("-1500000")).toEqual({ text: "−1.500000 PLAY", direction: "out" });
    expect(formatSignedAmount("1")).toEqual({ text: "+0.000001 PLAY", direction: "in" });
    expect(formatSignedAmount("0").direction).toBe("zero");
    expect(formatSignedAmount(null)).toEqual({ text: "Amount unavailable", direction: "unknown" });
    expect(formatSignedAmount("123456789012345678901").text).toBe("+123,456,789,012,345.678901 PLAY");
  });
});

describe("buildFeed", () => {
  it("keeps several actions in one signature as separate rows", () => {
    const a = item({ kind: "CoverBought" });
    const b = item({ kind: "PoolDeposit", instructionIndex: 1 });
    expect(buildFeed([page([a, b])]).items.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("dedupes recovered rows across pages and keeps pending from earlier pages", () => {
    const a = item();
    const b = item({ signature: SIG_B, slot: 90 });
    const feed = buildFeed([
      page([a], { pending: [SIG_B], retryCursor: "r1", nextBefore: SIG_A }),
      page([a, b], { nextBefore: SIG_B }),
    ]);
    expect(feed.items).toHaveLength(2);
    expect(feed.pendingCount).toBe(1);
    expect(feed.nextBefore).toBe(SIG_B);
  });

  it("an empty page with a continuation is not the end of history", () => {
    const feed = buildFeed([page([item()], { nextBefore: SIG_A }), page([], { nextBefore: SIG_B })]);
    expect(feed.lastPageEmptyWithContinuation).toBe(true);
    expect(feed.reachedEnd).toBe(false);
    expect(buildFeed([page([])]).reachedEnd).toBe(true);
  });
});

describe("groupByDay", () => {
  const opts = { locale: "en-US", timeZone: "America/New_York" };
  // 2024-03-11 12:00 EDT (the day after the US spring-forward change)
  const now = new Date("2024-03-11T16:00:00Z");

  it("uses Today / Yesterday / date in the browser zone and puts null times last", () => {
    const groups = groupByDay(
      [
        item({ id: "t", blockTime: Date.parse("2024-03-11T04:30:00Z") / 1000 }), // 00:30 EDT today
        item({ id: "y", blockTime: Date.parse("2024-03-11T03:30:00Z") / 1000 }), // 23:30 EDT on the 10th
        item({ id: "n", blockTime: null }),
        item({ id: "o", blockTime: Date.parse("2024-03-09T12:00:00Z") / 1000 }),
        item({ id: "n2", blockTime: null }),
      ],
      now,
      opts,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Mar 9, 2024", "Date unavailable"]);
    expect(groups[3].items.map((i) => i.id)).toEqual(["n", "n2"]);
  });

  it("depends on the time zone, not UTC", () => {
    const t = Date.parse("2024-03-11T02:00:00Z") / 1000;
    expect(groupByDay([item({ blockTime: t })], now, { timeZone: "UTC" })[0].label).toBe("Today");
    expect(groupByDay([item({ blockTime: t })], now, opts)[0].label).toBe("Yesterday");
  });

  it("handles month/year boundaries for yesterday", () => {
    const jan1 = new Date("2025-01-01T12:00:00Z");
    const t = Date.parse("2024-12-31T12:00:00Z") / 1000;
    expect(groupByDay([item({ blockTime: t })], jan1, { timeZone: "UTC" })[0].label).toBe("Yesterday");
  });
});

describe("market", () => {
  const session: SessionLike = {
    state: "Running",
    nObs: 48,
    nextIndex: 3,
    path: [
      { i: 0, periodId: 202301, value: "64100" },
      { i: 2, periodId: 202303, value: "49800" },
      { i: 1, periodId: 202302, value: "60400" },
    ],
  };
  it("orders accepted observations newest first with month labels, no padding", () => {
    const rows = marketRows(session);
    expect(rows.map((r) => r.label)).toEqual([
      "Mar 2023 recorded: 4.98 %",
      "Feb 2023 recorded: 6.04 %",
      "Jan 2023 recorded: 6.41 %",
    ]);
  });
  it("summarises terminal states", () => {
    expect(marketSummary({ ...session, state: "Settled" })?.title).toMatch(/settled/);
    expect(marketSummary({ ...session, state: "Refunding" })?.title).toBe("Session refunding");
    expect(marketSummary(session)?.description).toBe("3 of 48 observations recorded so far.");
  });
});

it("classifies cursor errors", () => {
  expect(classifyFeedError({ status: 400 })).toBe("expired");
  expect(classifyFeedError(new Error("x"))).toBe("generic");
});
