import { describe, expect, it, vi } from "vitest";
import type { SessionOverviewResponse, SessionView } from "@macropaths/client";
import sessionA from "../../../../packages/client/fixtures/session-B89z.view.json";
import positionsA from "../../../../packages/client/fixtures/positions-B89z.view.json";

import {
  addMonths,
  amountLabel,
  availableYears,
  buildChartModel,
  buildHeadline,
  buildHoldings,
  buildTerms,
  buildVault,
  classifyError,
  explainFigures,
  plainSummary,
  walkthroughStep,
  historicalRange,
  offerText,
  peakSummary,
  replayStatus,
  statePill,
} from "./model";

const A = sessionA as unknown as SessionView;
const presentation = { label: "US CPI 2021–2024 replay", mode: "historical_replay" as const, layout: "v1" as const, firstPeriodId: 202101, researchBundleId: null };
const OWNER = A.authority;
const OTHER = "11111111111111111111111111111111";

function overviewOf(session: SessionView, extra: Partial<{ currentScores: [string, string] | null; vaultOk: boolean }> = {}) {
  return {
    session,
    meta: { source: "fixture" as const, fetchedAt: "2026-10-25T00:00:00Z" },
    presentation,
    derived: { currentScores: extra.currentScores ?? null, poolDeposited: "380000000" },
    vault:
      extra.vaultOk === false
        ? ({ status: "unavailable", data: null } as const)
        : ({ status: "ok", data: { amounts: ["180000000", "190000000"], total: "370000000" } } as const),
    coverOffer: { status: "ok" as const, data: { seller: null, quote: null, status: "not_configured" as const } },
  } as unknown as SessionOverviewResponse;
}

const partial = (n: number, state: SessionView["state"] = "Running"): SessionView => ({
  ...A,
  state,
  nextIndex: n,
  integrityOk: false,
  path: A.path.slice(0, n),
  lastPeriodId: n ? A.path[n - 1].periodId : 0,
  stats: n ? { peak: A.path.slice(0, n).reduce((m, r) => (BigInt(r.value) > BigInt(m) ? r.value : m), A.path[0].value), maxDecline: A.path[n - 1].decline, excessAcc: A.path[n - 1].excess } : { peak: null, maxDecline: "0", excessAcc: "0" },
});

describe("reference session A", () => {
  it("keeps its own test terms and scores (not p90 research caps)", () => {
    expect(A.terms).toEqual({ k: "40000", dCap: "80000", aCap: "800000" });
    const h = buildHeadline(overviewOf(A));
    expect(h.scores.map((s) => s.value)).toEqual(["82.7 %", "86.4 %"]);
    expect(h.scores[0].statistic).toContain("6.62");
    expect(h.scores[1].statistic).toContain("69.1");
    expect(h.scores[1].statistic).toContain("4.00 %");
    expect(h.lastReading).toEqual({ value: "2.89 %", month: "Dec 2024" });
    expect(buildTerms(A).map((t) => t.value)).toEqual(["4.00 %", expect.stringContaining("8.00"), expect.stringContaining("80.0")]);
  });

  it("reports the peak month and 380 PLAY deposited", () => {
    expect(peakSummary(A)).toBe("Peak 9.06 % in Jun 2022");
    const v = buildVault(overviewOf(A));
    expect(v.totalDeposited).toBe("380.00 PLAY");
    expect(v.segments).toHaveLength(4);
    expect(v.segments.map((s) => s.amount)).toEqual(["90.00 PLAY", "100.00 PLAY", "90.00 PLAY", "100.00 PLAY"]);
  });

  it("is a verified complete replay over Jan 2021 – Dec 2024", () => {
    expect(replayStatus(A)).toBe("complete_verified");
    expect(historicalRange(presentation, A)?.label).toBe("Jan 2021 – Dec 2024");
    expect(statePill(A)).toEqual({ tone: "settled", label: "Settled" });
  });
});

describe("chart", () => {
  it("uses exact formatted values and the session threshold", () => {
    const c = buildChartModel(A);
    expect(c.series).toHaveLength(1);
    expect(c.series[0].points).toHaveLength(48);
    expect(c.series[0].points[0]).toMatchObject({ id: "obs-0", x: 0, label: "Jan 2021", formattedValue: "1.40 %" });
    expect(c.threshold.value).toBe(4);
    expect(c.threshold.label).toBe("Threshold 4.00 %");
    expect(c.threshold.bandLabel).toBe("69.1 point-months above 4.00 %");
    expect(c.xTicks.map((t) => t.label)).toEqual(["2021", "2022", "2023", "2024"]);
  });

  it("threshold follows terms.k, not a hardcoded 4%", () => {
    const c = buildChartModel({ ...A, terms: { ...A.terms, k: "30000" } });
    expect(c.threshold.label).toBe("Threshold 3.00 %");
    expect(c.threshold.bandLabel).toBe("69.1 point-months above 3.00 %");
    expect(buildChartModel(partial(0, "Open")).threshold.bandLabel).toBeUndefined();
  });

  it("range selection crops the display but not scores", () => {
    expect(availableYears(A)).toEqual([2021, 2022, 2023, 2024]);
    const before = buildHeadline(overviewOf(A));
    const c = buildChartModel(A, 2022);
    expect(c.series[0].points).toHaveLength(12);
    expect(c.series[0].points[0].label).toBe("Jan 2022");
    expect(buildHeadline(overviewOf(A))).toEqual(before);
  });

  it("empty path gives an empty chart and no invented dates", () => {
    const open = partial(0, "Open");
    expect(buildChartModel(open).series[0].points).toEqual([]);
    expect(historicalRange(presentation, open)?.label).toBe("Jan 2021 – Dec 2024");
    expect(historicalRange({ firstPeriodId: 0 }, open)).toBeNull();
  });
});

describe("state semantics", () => {
  it("Open without observations: nothing determined", () => {
    const h = buildHeadline(overviewOf(partial(0, "Open")));
    expect(h.lastReading).toBeNull();
    expect(h.scores.every((s) => s.value === null && s.statistic === null)).toBe(true);
    expect(replayStatus(partial(0, "Open"))).toBe("not_started");
  });

  it("partially recorded Running is normal, not an integrity failure", () => {
    const s = partial(20);
    expect(replayStatus(s)).toBe("in_progress");
    const h = buildHeadline(overviewOf(s, { currentScores: ["500000", "100000"] }));
    expect(h.scores[0].value).toBe("50.0 %");
    expect(h.scores[0].note).toMatch(/until settlement/);
    expect(h.lastReading?.month).toBe("Aug 2022");
  });

  it("completed mismatch is a separate error state", () => {
    expect(replayStatus({ ...A, integrityOk: false })).toBe("complete_mismatch");
  });

  it("Refunding keeps scores away from amounts", () => {
    const h = buildHeadline(overviewOf({ ...A, state: "Refunding" }, { currentScores: ["827387", "863980"] }));
    expect(h.scores[0].note).toMatch(/refunding/i);
    expect(statePill({ ...A, state: "Refunding" }).tone).toBe("refunding");
    expect(amountLabel("claimed", "Refunding")).toBe("Refunded");
    expect(amountLabel("refund", "Refunding")).toBe("Refund available");
  });
});

describe("vault and offer", () => {
  it("keeps deposited totals when vault balances are unavailable", () => {
    const v = buildVault(overviewOf(A, { vaultOk: false }));
    expect(v.current.status).toBe("unavailable");
    expect(v.totalDeposited).toBe("380.00 PLAY");
  });
  it("reports current vault balances separately", () => {
    const v = buildVault(overviewOf(A));
    expect(v.current).toMatchObject({ status: "ok", total: "370.00 PLAY" });
  });
  it("describes an unavailable seller read", () => {
    expect(offerText({ coverOffer: { status: "unavailable", data: null } })).toMatch(/unavailable/);
    expect(offerText(overviewOf(A))).toMatch(/No seller offer/);
  });
});

describe("holdings", () => {
  const position = positionsA.positions[0];
  const cover = { address: OTHER, owner: OWNER, units: ["10000000", "0"], premiumPaid: ["600000", "0"], claimed: false, payout: ["8273870", "0"] };
  const wallet = (pos: unknown, cov: unknown, owner = OWNER) => ({
    owner,
    meta: { source: "fixture" as const, fetchedAt: "x" },
    balances: [],
    holdings: [{ sessionAddress: A.address, read: { status: "ok" as const, data: { position: pos, cover: cov } } }],
  }) as never;
  const fake = vi.fn((_s: SessionView, p: { claimed: boolean } | null, c: unknown) => ({
    position: p ? { paid: "380000000", amount: p.claimed ? "380000000" : "380000000", unclaimed: p.claimed ? "0" : "380000000", status: p.claimed ? ("claimed" as const) : ("payout" as const) } : null,
    cover: c ? { paid: "600000", amount: "8273870", unclaimed: "8273870", status: "payout" as const, maximumPayout: "10000000" } : null,
    unclaimedTotal: p?.claimed ? "8273870" : "388273870",
  }));

  it("disconnected wallet", () => {
    expect(buildHoldings(A, { owner: null, wallet: undefined, isPending: false, isError: false }, fake).kind).toBe("disconnected");
  });
  it("loading / error / unrelated owner response", () => {
    expect(buildHoldings(A, { owner: OWNER, wallet: undefined, isPending: true, isError: false }, fake).kind).toBe("loading");
    expect(buildHoldings(A, { owner: OWNER, wallet: undefined, isPending: false, isError: true }, fake).kind).toBe("error");
    expect(buildHoldings(A, { owner: OWNER, wallet: wallet(position, null, OTHER), isPending: false, isError: false }, fake).kind).toBe("loading");
  });
  it("filters out accounts owned by another wallet", () => {
    expect(buildHoldings(A, { owner: OTHER, wallet: wallet(position, null, OTHER), isPending: false, isError: false }, fake).kind).toBe("empty");
  });
  it("unavailable holdings section stays unavailable, not zero", () => {
    const w = { owner: OWNER, meta: {}, balances: [], holdings: [{ sessionAddress: A.address, read: { status: "unavailable", data: null } }] } as never;
    expect(buildHoldings(A, { owner: OWNER, wallet: w, isPending: false, isError: false }, fake).kind).toBe("unavailable");
  });
  it("covers first, positions separately, final payouts labelled", () => {
    const m = buildHoldings(A, { owner: OWNER, wallet: wallet(position, cover), isPending: false, isError: false }, fake);
    expect(m.kind).toBe("ok");
    if (m.kind !== "ok") return;
    expect(m.covers[0].rows.map((r) => r.label)).toEqual(["Premium paid", "Maximum payout", "Final payout"]);
    expect(m.covers[0].rows[1].value).toBe("10.00 PLAY");
    expect(m.positions[0].rows[0]).toEqual({ label: "Deposited", value: "380.00 PLAY" });
    expect(m.unclaimedTotal).toBe("388.27 PLAY");
  });
  it("claimed holding does not inflate the available total", () => {
    const m = buildHoldings(A, { owner: OWNER, wallet: wallet({ ...position, claimed: true }, cover), isPending: false, isError: false }, fake);
    if (m.kind !== "ok") throw new Error("expected ok");
    expect(m.positions[0].rows[1].label).toBe("Claimed");
    expect(m.unclaimedTotal).toBe("8.27 PLAY");
  });
  it("Running illustration and undetermined amounts are labelled, null never becomes zero", () => {
    const s = partial(20);
    const summ = () => ({
      position: { paid: "1000000", amount: null, unclaimed: null, status: "undetermined" as const },
      cover: { paid: "600000", amount: "5000000", unclaimed: "5000000", status: "illustration" as const, maximumPayout: "10000000" },
      unclaimedTotal: null,
    });
    const m = buildHoldings(s, { owner: OWNER, wallet: wallet(position, cover), isPending: false, isError: false }, summ);
    if (m.kind !== "ok") throw new Error("expected ok");
    expect(m.covers[0].rows[2]).toEqual({ label: "Accrued payout illustration", value: "5.00 PLAY", note: "Illustration until settlement" });
    expect(m.positions[0].rows[1]).toEqual({ label: "Not determined yet", value: "Not determined yet" });
    expect(m.unclaimedTotal).toBeNull();
  });
});

describe("curation and approved additions", () => {
  it("plain-language summary from exact statistics", () => {
    expect(plainSummary(A)).toBe(
      "Inflation peaked at 9.06 % in Jun 2022 and later fell by up to 6.62 pp from an earlier peak. Readings accumulated 69.1 point-months above the 4.00 % threshold.",
    );
    expect(plainSummary(partial(0, "Open"))).toBeNull();
    expect(plainSummary(partial(20))).toMatch(/so far\.$/);
  });

  it("explain-this-number uses session terms, never research caps", () => {
    const e = explainFigures(overviewOf(A));
    expect(e.cooling).toBe("Largest decline 6.62 pp ÷ decline cap 8.00 pp = 82.7 %.");
    expect(e.excess).toBe("Excess 69.1 point-months ÷ excess cap 80.0 point-months = 86.4 %.");
    expect(e.lastReading).toMatch(/Dec 2024.*48 of 48/);
    expect(explainFigures(overviewOf(partial(0, "Open"))).cooling).toMatch(/not determined yet/);
  });

  it("composition segments pass exact raw side totals to the shared ShareBar", () => {
    expect(buildVault(overviewOf(A)).segments.map((s) => s.raw)).toEqual(A.sideTotals);
    expect(buildVault(overviewOf(A)).segments.map((s) => s.label)).toEqual([
      "Inflation Cooling · More",
      "Inflation Cooling · Less",
      "Excess Inflation · More",
      "Excess Inflation · Less",
    ]);
  });

  it("walkthrough reveals the recorded path to the final scores", () => {
    const first = walkthroughStep(A, 0)!;
    expect(first.month).toBe("Jan 2021");
    expect(first.label).toBe("Illustration until settlement");
    const end = walkthroughStep(A, 47)!;
    expect(end.scores).toEqual(["82.7 %", "86.4 %"]);
    expect(end.final).toBe(true);
    expect(end.label).toBe("Final payout");
    // 827387 + 863980 millionths of 1 PLAY each
    expect(end.payout).toContain("1.69 PLAY");
    expect(walkthroughStep(A, 99)!.step).toBe(47);
    expect(walkthroughStep(partial(20), 19)!.label).toBe("Illustration until settlement");
    expect(walkthroughStep({ ...A, state: "Refunding" }, 47)!.final).toBe(false);
    expect(walkthroughStep(partial(0, "Open"), 0)).toBeNull();
  });
});

describe("misc", () => {
  it("month arithmetic and error mapping", () => {
    expect(addMonths(202101, 47)).toBe(202412);
    expect(addMonths(202112, 1)).toBe(202201);
    expect(classifyError({ status: 404 })).toBe("not_found");
    expect(classifyError({ code: "not_found" })).toBe("not_found");
    expect(classifyError(new Error("rpc_error"))).toBe("failed");
  });
});
