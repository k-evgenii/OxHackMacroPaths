// Presentation values come from the independently checked reference fixture.
// All settlement calculations use the shared bigint client.
import fixture from "@macropaths/client/fixtures/session-B89z.view.json";
import {
  budgets,
  claimAmount,
  recomputePath,
  score,
  PROGRAM_ID as ID,
} from "@macropaths/client";

export const X = fixture.path.map((row) => Number(row.value));
export const CPI_YOY = fixture.path.map((row) => ({
  period: new Date(
    Date.UTC(Math.floor(row.periodId / 100), (row.periodId % 100) - 1),
  ).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }),
  value: Number(row.value) / 10000,
  x: Number(row.value),
}));
export const TOTAL_OBSERVATIONS = fixture.nObs;
export const THRESHOLD = Number(fixture.terms.k) / 10000;
export const DEMO_WALLET_BALANCE = 1000;
export const PROGRAM_ID = ID.toBase58();
export const SESSION_ADDRESS = fixture.address;
export const ON_CHAIN = false; // User actions in this walkthrough never send transactions.
export const explorerLink = (signature: string) =>
  `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
export type Amounts = [number, number, number, number];
export type PracticeEntry = {
  id: string;
  monthIndex: number;
  amounts: Amounts;
};
export const MAX_PRACTICE_ENTRIES = 25;
export const REFERENCE_POTS = fixture.sideTotals.map(
  (amount) => Number(amount) / 1e6,
) as Amounts;
export function amountsThrough(
  entries: readonly PracticeEntry[],
  monthIndex = TOTAL_OBSERVATIONS - 1,
): Amounts {
  const sums = [0n, 0n, 0n, 0n];
  for (const entry of entries) {
    if (entry.monthIndex > monthIndex) continue;
    entry.amounts.forEach((amount, side) => {
      sums[side] += toBase(amount);
    });
  }
  return sums.map((amount) => Number(amount) / 1e6) as Amounts;
}
export function potsThrough(
  entries: readonly PracticeEntry[],
  monthIndex: number,
): Amounts {
  const added = amountsThrough(entries, monthIndex);
  return REFERENCE_POTS.map((base, side) => base + added[side]) as Amounts;
}
export type Scores = { cooling: number; excess: number };
export type Activity = {
  id: number;
  time: string;
  kind: string;
  detail: string;
  amount?: number;
};
export type PathStats = {
  peak: number;
  largestDecline: number;
  accumulatedExcess: number;
  monthsAbove: number;
  peaks: number[];
  D: number;
  A: number;
};

export function pathStats(values: number[]): PathStats {
  const raw = values.map((v) => BigInt(Math.round(v * 10000)));
  const rows = recomputePath(raw, BigInt(fixture.terms.k), 202412);
  const last = rows.at(-1);
  return {
    peak: Number(last?.peak ?? 0) / 10000,
    largestDecline: Number(last?.decline ?? 0) / 10000,
    accumulatedExcess: Number(last?.excess ?? 0) / 10000,
    monthsAbove: raw.filter((v) => v > BigInt(fixture.terms.k)).length,
    peaks: rows.map((r) => Number(r.peak) / 10000),
    D: Number(last?.decline ?? 0),
    A: Number(last?.excess ?? 0),
  };
}
export const scoresFrom = (s: PathStats): Scores => ({
  cooling: Number(score(BigInt(s.D), BigInt(fixture.terms.dCap))) / 1e6,
  excess: Number(score(BigInt(s.A), BigInt(fixture.terms.aCap))) / 1e6,
});

export function toBase(play: number): bigint {
  if (!Number.isFinite(play) || play < 0 || play > DEMO_WALLET_BALANCE)
    throw new RangeError("Invalid demo amount");
  return BigInt(play.toFixed(6).replace(".", ""));
}
export function claimsBySide(amounts: Amounts, scores: Scores): number[] {
  const deposits = amounts.map(toBase);
  const totals = fixture.sideTotals.map((s, j) => BigInt(s) + deposits[j]);
  const b = budgets(totals, [
    BigInt(Math.round(scores.cooling * 1e6)),
    BigInt(Math.round(scores.excess * 1e6)),
  ]);
  return deposits.map(
    (a, j) => Number(claimAmount(a, b.r[j], b.p[j], totals[j])) / 1e6,
  );
}
export const illustrativePayout = (a: Amounts, s: Scores) =>
  claimsBySide(a, s).reduce((sum, v) => sum + v, 0);
export function payoutRange(a: Amounts) {
  const payouts = [0, 1].flatMap((cooling) =>
    [0, 1].map((excess) => illustrativePayout(a, { cooling, excess })),
  );
  return { min: Math.min(...payouts), max: Math.max(...payouts) };
}
export const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
export const FINAL_SCORES = scoresFrom(pathStats(CPI_YOY.map((o) => o.value)));
