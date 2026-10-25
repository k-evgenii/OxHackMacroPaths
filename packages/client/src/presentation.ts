// Shared exact presentation helpers (docs/frontend-v2/interfaces.md "Exact helper exports").
// Pure bigint/string arithmetic: never convert token sums to Number. Browser-safe (no decoder/RPC).
// Foundation implementation; worker 01 owns hardening and tests.
import { budgets, claimAmount, coverPayout, score } from "./math";
import type { CoverView, PositionView, SessionView } from "./types";

export { fmtPpDifference, fmtPointMonths, fmtQuotePlay } from "./format";

type S = string;
type Pair<T> = [T, T];

export type AmountSummary = {
  paid: S;
  /** total payout/refund (not net profit); null when undetermined */
  amount: S | null;
  /** amount still claimable; '0' once claimed; null when not determined or not yet claimable */
  unclaimed: S | null;
  status: "undetermined" | "illustration" | "payout" | "refund" | "claimed";
};
export type HoldingSummary = {
  position: AmountSummary | null;
  cover: (AmountSummary & { maximumPayout: S }) | null;
  unclaimedTotal: S | null;
};

const INT = /^-?\d+$/;

/** Exact bigint sum of decimal-integer strings. Callers must not mix mints/currencies or unavailable entries. */
export function sumAmounts(values: readonly S[]): S {
  let t = 0n;
  for (const v of values) {
    if (!INT.test(v)) throw new Error(`sumAmounts: not a decimal integer: ${JSON.stringify(v)}`);
    t += BigInt(v);
  }
  return t.toString();
}

/**
 * Accrued product scores (millionths) for display.
 * Settled: recorded scores. Running with observations: score(maxDecline, dCap) / score(excessAcc, aCap).
 * Open, Running before the first observation, and Refunding: null.
 */
export function calculateAccruedScores(session: SessionView): Pair<S> | null {
  switch (session.state) {
    case "Settled":
      return [session.scores[0], session.scores[1]];
    case "Running":
      if (session.nextIndex === 0) return null;
      return [
        score(BigInt(session.stats.maxDecline), BigInt(session.terms.dCap)).toString(),
        score(BigInt(session.stats.excessAcc), BigInt(session.terms.aCap)).toString(),
      ];
    default:
      return null;
  }
}

function positionSummary(session: SessionView, p: PositionView): AmountSummary {
  const paid = sumAmounts(p.deposited);
  if (session.state === "Settled" || session.state === "Refunding") {
    const refund = session.state === "Refunding";
    // Settled payout = claimAmount per side (from the view); Refunding = deposits.
    const amount = refund ? paid : p.payout ? sumAmounts(p.payout) : null;
    if (amount === null) return { paid, amount: null, unclaimed: null, status: "undetermined" };
    if (p.claimed) return { paid, amount, unclaimed: "0", status: "claimed" };
    return { paid, amount, unclaimed: amount, status: refund ? "refund" : "payout" };
  }
  const scores = session.state === "Running" ? calculateAccruedScores(session) : null;
  if (!scores) return { paid, amount: null, unclaimed: null, status: "undetermined" };
  // Temporary budgets from accrued scores; the stored (unsettled) P/R budgets are not used.
  const totals = session.sideTotals.map(BigInt);
  const b = budgets(totals, scores.map(BigInt));
  const amount = p.deposited.reduce(
    (acc, d, j) => acc + claimAmount(BigInt(d), b.r[j], b.p[j], totals[j]),
    0n,
  );
  return { paid, amount: amount.toString(), unclaimed: null, status: "illustration" };
}

function coverSummary(session: SessionView, c: CoverView): AmountSummary & { maximumPayout: S } {
  const paid = sumAmounts(c.premiumPaid);
  const maximumPayout = sumAmounts(c.units);
  if (session.state === "Settled" || session.state === "Refunding") {
    const refund = session.state === "Refunding";
    const amount = refund ? paid : c.payout ? sumAmounts(c.payout) : null;
    if (amount === null) return { paid, amount: null, unclaimed: null, status: "undetermined", maximumPayout };
    if (c.claimed) return { paid, amount, unclaimed: "0", status: "claimed", maximumPayout };
    return { paid, amount, unclaimed: amount, status: refund ? "refund" : "payout", maximumPayout };
  }
  const scores = session.state === "Running" ? calculateAccruedScores(session) : null;
  if (!scores) return { paid, amount: null, unclaimed: null, status: "undetermined", maximumPayout };
  const amount = c.units.reduce((acc, u, i) => acc + coverPayout(BigInt(scores[i]), BigInt(u)), 0n);
  return { paid, amount: amount.toString(), unclaimed: null, status: "illustration", maximumPayout };
}

/**
 * Per-session holding summary in the session's own mint.
 * unclaimedTotal: '0' with no holdings; null when any held, not-yet-claimed item has no claimable amount
 * (undetermined or illustration); otherwise the exact sum of claimable amounts (claimed items contribute 0).
 */
export function summarizeHolding(
  session: SessionView,
  position: PositionView | null,
  cover: CoverView | null,
): HoldingSummary {
  const pos = position ? positionSummary(session, position) : null;
  const cov = cover ? coverSummary(session, cover) : null;
  const parts = [pos, cov].filter((x): x is AmountSummary => x !== null);
  const unclaimedTotal = parts.some((x) => x.unclaimed === null)
    ? null
    : sumAmounts(parts.map((x) => x.unclaimed as S));
  return { position: pos, cover: cov, unclaimedTotal };
}
