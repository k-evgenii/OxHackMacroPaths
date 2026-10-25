// Pure view-model adapters for the client Session page. No React, no token math beyond the shared
// exact helpers. Chart numbers are display coordinates only; every displayed string comes from the
// exact shared formatters.
import {
  fmtMillionthsPct,
  fmtPeriod,
  fmtPlay,
  fmtPp,
  fmtPpDifference,
  fmtPointMonths,
  summarizeHolding as sharedSummarizeHolding,
  score as sharedScore,
  coverPayout as sharedCoverPayout,
  type AmountSummary,
  type HoldingSummary,
  type SessionOverviewResponse,
  type SessionView,
  type WalletOverviewResponse,
} from "@macropaths/client";

export const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Product indices on chain: 0 = Inflation Cooling, 1 = Excess Inflation. */
export const PRODUCTS = [
  { index: 0 as const, key: "cooling" as const, name: "Inflation Cooling" },
  { index: 1 as const, key: "excess" as const, name: "Excess Inflation" },
];

// ---------------------------------------------------------------------------------------------
// Periods

/** YYYYMM + n months (n may be 0). */
export function addMonths(periodId: number, n: number): number {
  const y = Math.floor(periodId / 100);
  const m = (periodId % 100) - 1 + n;
  return (y + Math.floor(m / 12)) * 100 + (((m % 12) + 12) % 12) + 1;
}

/**
 * Historical date range from registry metadata (firstPeriodId, nObs). It never turns an unset
 * lastPeriodId=0 into a date. Returns null when the registry period is not a valid YYYYMM.
 */
export function historicalRange(
  presentation: Pick<SessionOverviewResponse["presentation"], "firstPeriodId">,
  session: Pick<SessionView, "nObs">,
): { first: number; last: number; label: string } | null {
  const first = presentation.firstPeriodId;
  const m = first % 100;
  if (!Number.isInteger(first) || first < 100001 || m < 1 || m > 12 || session.nObs < 1) return null;
  const last = addMonths(first, session.nObs - 1);
  return { first, last, label: `${fmtPeriod(first)} – ${fmtPeriod(last)}` };
}

// ---------------------------------------------------------------------------------------------
// State, progress and replay verification

export type PillTone = "open" | "running" | "settled" | "refunding";
export type ReplayStatus = "not_started" | "in_progress" | "complete_verified" | "complete_mismatch";

export function statePill(session: SessionView): { tone: PillTone; label: string } {
  switch (session.state) {
    case "Open":
      return { tone: "open", label: "Open" };
    case "Running":
      return { tone: "running", label: "Running" };
    case "Settled":
      return { tone: "settled", label: "Settled" };
    case "Refunding":
      return { tone: "refunding", label: "Refunding" };
  }
}

/**
 * Incomplete replay is a normal state: integrityOk=false while observations are still arriving is
 * not a failure. Only a completed replay can be verified or mismatched.
 */
export function replayStatus(session: SessionView): ReplayStatus {
  if (session.nextIndex === 0) return "not_started";
  if (session.nextIndex < session.nObs) return "in_progress";
  return session.integrityOk ? "complete_verified" : "complete_mismatch";
}

export function replayProgress(session: SessionView): { recorded: number; total: number; label: string } {
  return {
    recorded: session.nextIndex,
    total: session.nObs,
    label: `${session.nextIndex} of ${session.nObs} monthly readings recorded`,
  };
}

// ---------------------------------------------------------------------------------------------
// Headline figures

export type Headline = {
  lastReading: { value: string; month: string } | null;
  scores: Array<{
    key: "cooling" | "excess";
    name: string;
    value: string | null;
    statistic: string | null;
    note: string;
  }>;
};

/**
 * Scores: exact contract scores. Running uses the server-derived current scores; Settled uses the
 * stored final scores; Open has none. Refunding keeps the statistic visible but never as an amount.
 */
export function buildHeadline(overview: Pick<SessionOverviewResponse, "session" | "derived">): Headline {
  const s = overview.session;
  const last = s.path.length > 0 ? s.path[s.path.length - 1] : null;
  let scores: readonly [string, string] | null = null;
  if (s.state === "Settled") scores = s.scores;
  else if (s.state === "Running" || s.state === "Refunding") scores = overview.derived.currentScores;

  const note =
    s.state === "Open"
      ? "Not determined until readings arrive"
      : s.state === "Running"
        ? "So far — changes until settlement"
        : s.state === "Refunding"
          ? "Not used for payouts: session is refunding"
          : "Final";

  const hasPath = s.path.length > 0;
  return {
    lastReading: last ? { value: fmtPp(last.value, 2), month: fmtPeriod(last.periodId) } : null,
    scores: [
      {
        key: "cooling",
        name: "Inflation Cooling",
        value: scores ? fmtMillionthsPct(scores[0], 1) : null,
        statistic: hasPath ? `Largest decline ${ppMagnitude(s.stats.maxDecline, 2)}` : null,
        note,
      },
      {
        key: "excess",
        name: "Excess Inflation",
        value: scores ? fmtMillionthsPct(scores[1], 1) : null,
        statistic: hasPath ? `Excess above ${fmtPp(s.terms.k, 2)}: ${fmtPointMonths(s.stats.excessAcc, 1)}` : null,
        note,
      },
    ],
  };
}

/** Peak line for the summary, e.g. "Peak 9.06 % in Jun 2022". */
export function peakSummary(session: SessionView): string | null {
  if (session.stats.peak == null || session.path.length === 0) return null;
  const peak = BigInt(session.stats.peak);
  const row = session.path.find((r) => BigInt(r.value) === peak);
  return row ? `Peak ${fmtPp(session.stats.peak, 2)} in ${fmtPeriod(row.periodId)}` : `Peak ${fmtPp(session.stats.peak, 2)}`;
}

/** This session's own (test) terms, formatted exactly. Never research p90 caps. */
export function buildTerms(session: SessionView): Array<{ label: string; value: string }> {
  return [
    { label: "Threshold", value: fmtPp(session.terms.k, 2) },
    { label: "Decline cap (Inflation Cooling)", value: ppMagnitude(session.terms.dCap, 2) },
    { label: "Excess cap (Excess Inflation)", value: fmtPointMonths(session.terms.aCap, 1) },
  ];
}

// ---------------------------------------------------------------------------------------------
// Chart

export type ChartRange = "all" | number;

export type ChartModel = {
  title: string;
  summary: string;
  series: Array<{
    id: string;
    label: string;
    points: Array<{ id: string; x: number; value: number | null; label: string; formattedValue: string }>;
    tone: "primary";
  }>;
  threshold: { value: number; label: string };
  xTicks: Array<{ x: number; label: string }>;
  observations: Array<{ id: string; month: string; value: string }>;
};

export function availableYears(session: SessionView): number[] {
  const years = new Set(session.path.map((r) => Math.floor(r.periodId / 100)));
  return [...years].sort((a, b) => a - b);
}

/** Display coordinate (percent) for a 1e-4 pp value. Never fed back into amounts. */
const plotPp = (v: string): number => Number(v) / 10_000;

/**
 * The range crops the display only; it never changes the contract's scoring window or scores.
 */
export function buildChartModel(session: SessionView, range: ChartRange = "all"): ChartModel {
  const rows = range === "all" ? session.path : session.path.filter((r) => Math.floor(r.periodId / 100) === range);
  const points = rows.map((r) => ({
    id: `obs-${r.i}`,
    x: r.i,
    value: plotPp(r.value),
    label: fmtPeriod(r.periodId),
    formattedValue: fmtPp(r.value, 2),
  }));
  const ticks = rows.filter((r, idx) => (range === "all" ? r.periodId % 100 === 1 : idx % 3 === 0));
  const threshold = {
    value: plotPp(session.terms.k),
    label:
      session.path.length > 0
        ? `${fmtPointMonths(session.stats.excessAcc, 1)} above ${fmtPp(session.terms.k, 2)}`
        : `Threshold ${fmtPp(session.terms.k, 2)}`,
  };
  const first = rows[0];
  const last = rows[rows.length - 1];
  const summary =
    rows.length === 0
      ? "No monthly readings have been recorded yet."
      : `${rows.length} monthly CPI year-on-year readings from ${fmtPeriod(first.periodId)} to ${fmtPeriod(last.periodId)}; last ${fmtPp(last.value, 2)}. Threshold ${fmtPp(session.terms.k, 2)}.`;
  return {
    title: "Recorded inflation path",
    summary,
    series: [{ id: "cpi", label: "CPI year-on-year", points, tone: "primary" }],
    threshold,
    xTicks: ticks.map((r) => ({ x: r.i, label: range === "all" ? String(Math.floor(r.periodId / 100)) : fmtPeriod(r.periodId) })),
    observations: rows.map((r) => ({ id: `obs-${r.i}`, month: fmtPeriod(r.periodId), value: fmtPp(r.value, 2) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Vaults and pool contributions

export type VaultModel = {
  totalDeposited: string;
  segments: Array<{ id: string; label: string; amount: string }>;
  current: { status: "ok"; total: string; perProduct: Array<{ label: string; amount: string }> } | { status: "unavailable" };
};

/**
 * "Total deposited" is the exact historical pool-contribution aggregate (sideTotals); "currently held
 * in vaults" comes only from the token-account read. The four segments are pool contributions only.
 */
export function buildVault(overview: Pick<SessionOverviewResponse, "session" | "derived" | "vault">): VaultModel {
  const s = overview.session;
  const sides = ["More", "Less"] as const;
  const segments = PRODUCTS.flatMap((p) =>
    sides.map((side, k) => ({
      id: `${p.key}-${side.toLowerCase()}`,
      label: `${p.name} · ${side}`,
      amount: fmtPlay(s.sideTotals[p.index * 2 + k]),
    })),
  );
  const v = overview.vault;
  const current: VaultModel["current"] =
    v.status === "ok"
      ? {
          status: "ok",
          total: fmtPlay(v.data.total),
          perProduct: PRODUCTS.map((p) => ({ label: `${p.name} vault`, amount: fmtPlay(v.data.amounts[p.index]) })),
        }
      : { status: "unavailable" };
  return { totalDeposited: fmtPlay(overview.derived.poolDeposited), segments, current };
}

// ---------------------------------------------------------------------------------------------
// Cover offer (description only; purchasing is not implemented in this release)

export function offerText(overview: Pick<SessionOverviewResponse, "coverOffer">): string {
  if (overview.coverOffer.status === "unavailable") return "Cover offer information is unavailable right now.";
  switch (overview.coverOffer.data.status) {
    case "available":
      return "A seller offer is configured for this session. Buying covers is not available in this app yet.";
    case "not_configured":
      return "No seller offer is configured for this session.";
    case "closed":
      return "The seller offer is closed for this session.";
    case "unfunded":
      return "The seller offer currently has no funds available.";
  }
}

// ---------------------------------------------------------------------------------------------
// Holdings

export type AmountRow = { label: string; value: string; note?: string };
export type HoldingCard = { title: string; status: AmountSummary["status"]; rows: AmountRow[] };

export type HoldingsModel =
  | { kind: "disconnected" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "unavailable" }
  | { kind: "empty" }
  | { kind: "ok"; covers: HoldingCard[]; positions: HoldingCard[]; unclaimedTotal: string | null };

export function amountLabel(status: AmountSummary["status"], state: SessionView["state"]): string {
  switch (status) {
    case "undetermined":
      return "Not determined yet";
    case "illustration":
      return "Accrued payout illustration";
    case "payout":
      return "Final payout";
    case "refund":
      return "Refund available";
    case "claimed":
      return state === "Refunding" ? "Refunded" : "Claimed";
  }
}

function amountRow(summary: AmountSummary, state: SessionView["state"]): AmountRow {
  const label = amountLabel(summary.status, state);
  if (summary.amount == null) return { label, value: "Not determined yet" };
  return {
    label,
    value: fmtPlay(summary.amount),
    note: summary.status === "illustration" ? "Illustration until settlement" : undefined,
  };
}

type Summarize = (
  session: SessionView,
  position: Parameters<typeof sharedSummarizeHolding>[1],
  cover: Parameters<typeof sharedSummarizeHolding>[2],
) => HoldingSummary;

export function buildHoldings(
  session: SessionView,
  input: {
    owner: string | null;
    wallet: WalletOverviewResponse | undefined;
    isPending: boolean;
    isError: boolean;
  },
  summarize: Summarize = sharedSummarizeHolding,
): HoldingsModel {
  if (!input.owner) return { kind: "disconnected" };
  if (input.isError) return { kind: "error" };
  if (input.isPending || !input.wallet) return { kind: "loading" };
  // Never show another wallet's data as the connected user's holdings.
  if (input.wallet.owner !== input.owner) return { kind: "loading" };
  const entry = input.wallet.holdings.find((h) => h.sessionAddress === session.address);
  if (!entry) return { kind: "empty" };
  if (entry.read.status === "unavailable") return { kind: "unavailable" };
  const position = entry.read.data.position && entry.read.data.position.owner === input.owner ? entry.read.data.position : null;
  const cover = entry.read.data.cover && entry.read.data.cover.owner === input.owner ? entry.read.data.cover : null;
  if (!position && !cover) return { kind: "empty" };

  const summary = summarize(session, position, cover);
  const covers: HoldingCard[] = summary.cover
    ? [
        {
          title: "Cover",
          status: summary.cover.status,
          rows: [
            { label: "Premium paid", value: fmtPlay(summary.cover.paid) },
            { label: "Maximum payout", value: fmtPlay(summary.cover.maximumPayout) },
            amountRow(summary.cover, session.state),
          ],
        },
      ]
    : [];
  const positions: HoldingCard[] = summary.position
    ? [
        {
          title: "Pool position",
          status: summary.position.status,
          rows: [{ label: "Deposited", value: fmtPlay(summary.position.paid) }, amountRow(summary.position, session.state)],
        },
      ]
    : [];
  return {
    kind: "ok",
    covers,
    positions,
    unclaimedTotal: summary.unclaimedTotal == null ? null : fmtPlay(summary.unclaimedTotal),
  };
}

// ---------------------------------------------------------------------------------------------
// Plain-language summary, explanations, composition shares and walkthrough

/** Unsigned magnitude in percentage points, e.g. "6.62 pp" (decline is never negative). */
export const ppMagnitude = (v: string | bigint, digits = 2) => fmtPpDifference(v, digits).replace(/^\+/, "");

/** One sentence from exact recorded statistics; null before readings. */
export function plainSummary(session: SessionView): string | null {
  if (session.path.length === 0) return null;
  const peak = peakSummary(session);
  const parts: string[] = [];
  if (peak) parts.push(`Inflation ${peak.replace(/^Peak /, "peaked at ")}`);
  if (BigInt(session.stats.maxDecline) > 0n) parts.push(`later fell by up to ${ppMagnitude(session.stats.maxDecline)} from an earlier peak`);
  const first = parts.join(" and ");
  const second = `Readings accumulated ${fmtPointMonths(session.stats.excessAcc, 1)} above the ${fmtPp(session.terms.k, 2)} threshold`;
  return `${first ? first + ". " : ""}${second}${session.nextIndex < session.nObs ? " so far" : ""}.`;
}

/** "Explain this number" text for the three headline figures, from this session's terms. */
export function explainFigures(overview: Pick<SessionOverviewResponse, "session" | "derived">): {
  lastReading: string;
  cooling: string;
  excess: string;
} {
  const s = overview.session;
  const h = buildHeadline(overview);
  const last = s.path[s.path.length - 1];
  const capped = (stat: string, cap: string) => (BigInt(stat) >= BigInt(cap) ? " (capped at 100%)" : "");
  const result = (v: string | null) => (v ? ` = ${v}` : "; the score is not determined yet");
  return {
    lastReading: last
      ? `CPI year-on-year for ${fmtPeriod(last.periodId)}, the latest of ${s.nextIndex} of ${s.nObs} historical months replayed. It is a historical reading, not today's inflation.`
      : "No historical month has been replayed yet.",
    cooling: `Largest decline ${ppMagnitude(s.stats.maxDecline)} ÷ decline cap ${ppMagnitude(s.terms.dCap)}${result(h.scores[0].value)}${capped(s.stats.maxDecline, s.terms.dCap)}.`,
    excess: `Excess ${fmtPointMonths(s.stats.excessAcc, 1)} ÷ excess cap ${fmtPointMonths(s.terms.aCap, 1)}${result(h.scores[1].value)}${capped(s.stats.excessAcc, s.terms.aCap)}.`,
  };
}

/** Basis-point shares of the four pool-contribution sides, bigint-exact (floor; sums ≤ 10000). */
export function compositionShares(sideTotals: readonly string[]): number[] {
  const t = sideTotals.map((v) => BigInt(v));
  const total = t.reduce((a, b) => a + b, 0n);
  if (total === 0n) return t.map(() => 0);
  return t.map((v) => Number((v * 10_000n) / total));
}

export type WalkthroughStep = {
  step: number;
  total: number;
  month: string;
  caption: string;
  scores: [string, string];
  payout: string;
  final: boolean;
  label: string;
};

/** Example maximum payout used by the walkthrough: 1 PLAY per product. */
const EXAMPLE_UNITS = 1_000_000n;

/**
 * Step `step` (0-based) of the recorded path: statistics as of that month, the exact contract
 * scores they imply (shared bigint `score`) and the payout of an example cover (shared `coverPayout`).
 */
export function walkthroughStep(session: SessionView, step: number): WalkthroughStep | null {
  if (session.path.length === 0) return null;
  const i = Math.max(0, Math.min(step, session.path.length - 1));
  const row = session.path[i];
  const sc = [sharedScore(BigInt(row.decline), BigInt(session.terms.dCap)), sharedScore(BigInt(row.excess), BigInt(session.terms.aCap))] as const;
  const final = i === session.nObs - 1 && session.state === "Settled";
  const pay = sharedCoverPayout(sc[0], EXAMPLE_UNITS) + sharedCoverPayout(sc[1], EXAMPLE_UNITS);
  return {
    step: i,
    total: session.path.length,
    month: fmtPeriod(row.periodId),
    caption: `${fmtPeriod(row.periodId)}: inflation read ${fmtPp(row.value, 2)}. Peak so far ${fmtPp(row.peak, 2)}, largest decline ${ppMagnitude(row.decline)}, excess so far ${fmtPointMonths(row.excess, 1)}.`,
    scores: [fmtMillionthsPct(sc[0], 1), fmtMillionthsPct(sc[1], 1)],
    payout: `A cover with 1 PLAY maximum payout on each product would pay ${fmtPlay(pay)} in total.`,
    final,
    label: final ? "Final payout" : "Illustration until settlement",
  };
}

// ---------------------------------------------------------------------------------------------
// Errors

/** Map a query error to a page state without rendering raw error objects or URLs. */
export function classifyError(error: unknown): "not_found" | "failed" {
  if (error && typeof error === "object") {
    const e = error as { status?: unknown; code?: unknown; message?: unknown };
    if (e.status === 404 || e.code === "not_found") return "not_found";
    if (typeof e.message === "string" && /\b404\b|not[ _]found/i.test(e.message)) return "not_found";
  }
  return "failed";
}
