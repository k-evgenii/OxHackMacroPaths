// Bigint-exact ports of programs/macropaths/src/math.rs. Every division floors
// (operands are non-negative wherever a division happens).
import { ONE } from "./constants";
import type { PathRow } from "./types";

/** The YYYYMM period `back` months before `last`. */
function monthsBefore(last: number, back: number): number {
  const idx = Math.floor(last / 100) * 12 + (last % 100) - 1 - back;
  return Math.floor(idx / 12) * 100 + (idx % 12) + 1;
}

/** Running peak, max decline and excess per observation; periodIds are consecutive months ending at lastPeriodId. */
export function recomputePath(values: bigint[], k: bigint, lastPeriodId: number): PathRow[] {
  let peak: bigint | null = null;
  let decline = 0n;
  let excess = 0n;
  return values.map((x, i) => {
    const p: bigint = peak === null || x > peak ? x : peak;
    peak = p;
    if (p - x > decline) decline = p - x;
    if (x > k) excess += x - k;
    return {
      i,
      periodId: monthsBefore(lastPeriodId, values.length - 1 - i),
      value: x.toString(),
      peak: p.toString(),
      decline: decline.toString(),
      excess: excess.toString(),
    };
  });
}

/** 0 when stat < 0, else floor(min(stat, cap)·ONE / cap). Throws when cap <= 0. */
export function score(stat: bigint, cap: bigint): bigint {
  if (stat < 0n) return 0n;
  if (cap <= 0n) throw new RangeError("score: cap must be positive");
  return ((stat < cap ? stat : cap) * ONE) / cap;
}

/** Per product i: M = min(S0,S1), P0 = floor(2M·s/ONE), P1 = 2M − P0, R_j = S_j − M. */
export function budgets(sideTotals: bigint[], scores: bigint[]): { matched: bigint[]; p: bigint[]; r: bigint[] } {
  const matched: bigint[] = [];
  const p: bigint[] = [];
  const r: bigint[] = [];
  for (let i = 0; i < 2; i++) {
    const s0 = sideTotals[2 * i];
    const s1 = sideTotals[2 * i + 1];
    const m = s0 < s1 ? s0 : s1;
    const p0 = (2n * m * scores[i]) / ONE;
    matched.push(m);
    p.push(p0, 2n * m - p0);
    r.push(s0 - m, s1 - m);
  }
  return { matched, p, r };
}

/** floor(a·R/S) + floor(a·P/S); 0 when S == 0. */
export function claimAmount(deposited: bigint, r: bigint, p: bigint, sideTotal: bigint): bigint {
  if (sideTotal === 0n) return 0n;
  return (deposited * r) / sideTotal + (deposited * p) / sideTotal;
}

/** floor(s·units / ONE). */
export function coverPayout(scoreMillionths: bigint, units: bigint): bigint {
  return (scoreMillionths * units) / ONE;
}
