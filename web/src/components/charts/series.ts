// Pure helpers: chart series and gauge/budget math. No React.
import type { CoverView, PathRow, PositionView, SessionView } from "@macropaths/client";
import { period } from "./_fallback/format";

export interface SeriesPoint {
  i: number;
  label: string;
  /** percent, for plotting only (display text uses the string formatters) */
  value: number;
  peak: number;
  k: number;
  /** [k, max(value, k)] range for the shaded excess band */
  excessBand: [number, number];
  decline: string;
  excess: string;
}

const toPct = (s: string) => Number(s) / 1e4;

export function buildSeries(path: PathRow[], k: string): SeriesPoint[] {
  const kp = toPct(k);
  return path.map((r) => {
    const v = toPct(r.value);
    return {
      i: r.i,
      label: period(r.periodId),
      value: v,
      peak: toPct(r.peak),
      k: kp,
      excessBand: [kp, Math.max(v, kp)],
      decline: r.decline,
      excess: r.excess,
    };
  });
}

/** Index into path of the first row whose decline equals maxDecline, or null when maxDecline is 0. */
export function declineMarkerIndex(path: PathRow[], maxDecline: string): number | null {
  if (BigInt(maxDecline) <= 0n) return null;
  const idx = path.findIndex((r) => r.decline === maxDecline);
  return idx < 0 ? null : idx;
}

/** Fraction 0..1 of stat over cap, clamped (score = min(stat,cap)/cap). */
export function capFraction(stat: string, cap: string): number {
  const c = BigInt(cap);
  if (c <= 0n) return 0;
  const s = BigInt(stat) < 0n ? 0n : BigInt(stat);
  return Number((s < c ? s : c) * 1_000_000n / c) / 1e6;
}

/** Score in millionths -> gauge fraction 0..1. */
export const gaugeFraction = (score: string) => Math.min(1, Math.max(0, Number(score) / 1e6));

/** SVG arc path for a half-circle gauge from angle 180deg to 180deg - fraction*180deg. */
export function gaugeArc(fraction: number, r = 40, cx = 50, cy = 50): string {
  const f = Math.min(1, Math.max(0, fraction));
  const a = Math.PI * (1 - f);
  const x = cx + r * Math.cos(a);
  const y = cy - r * Math.sin(a);
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)}`;
}

/** claim per side j = floor(a*R/S) + floor(a*P/S), all bigint. */
export function projectedPayout(deposited: readonly string[], s: SessionView): bigint[] {
  return deposited.map((a, j) => {
    const S = BigInt(s.sideTotals[j]);
    if (S === 0n) return 0n;
    const A = BigInt(a);
    return (A * BigInt(s.rBudget[j])) / S + (A * BigInt(s.pBudget[j])) / S;
  });
}

/** Per-position payout per side: the on-chain view when present, else projected. */
export function positionPayout(p: PositionView, s: SessionView): bigint[] {
  return p.payout ? p.payout.map(BigInt) : projectedPayout(p.deposited, s);
}

export interface Totals {
  deposited: bigint;
  payout: bigint;
  dust: bigint;
}
export function totals(positions: PositionView[], s: SessionView): Totals {
  let deposited = 0n;
  let payout = 0n;
  for (const p of positions) {
    for (const d of p.deposited) deposited += BigInt(d);
    for (const x of positionPayout(p, s)) payout += x;
  }
  return { deposited, payout, dust: deposited - payout };
}

/** Cover payout per product: the on-chain view when present, else floor(score*units/1e6). */
export function coverPayout(c: CoverView, s: SessionView): bigint[] {
  return c.payout ? c.payout.map(BigInt) : c.units.map((u, n) => (BigInt(s.scores[n]) * BigInt(u)) / 1_000_000n);
}
