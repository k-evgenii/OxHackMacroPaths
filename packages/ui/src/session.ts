/*
 * Adapters from the on-chain Session account to kit props.
 * Pure functions, no web3 import: pass the object Anchor's `program.account.session.fetch()`
 * returns (camelCase keys, BN or bigint numbers). The frontend agent owns fetching.
 *
 * Units, from docs/demo-manifest.md and docs/commitment-chain.md:
 *   values, k, peak, maxDecline, dCap   1e-4 percentage points   (40000 = 4.00 pp)
 *   excessAcc, aCap                     1e-4 pp-months
 *   scores                              1e6 = full score         (827387 = 0.827)
 *   sideTotals, deposited               PLAY base units, 6 decimals assumed (stake · 1e6)
 *   sideTotals index                    product * 2 + side
 */

import type { ChangeRow } from "./data";
import type { CompositionSegment } from "./charts";
import type { PathPoint } from "./charts";
import type { StatusTone } from "./primitives";

export type NumLike = number | bigint | { toString(): string };

export interface SessionLike {
  sessionId: NumLike;
  nObs: number;
  nextIndex: number;
  lastPeriodId: number;
  state: Record<string, unknown> | string;
  k: NumLike;
  dCap: NumLike;
  aCap: NumLike;
  depositDeadline: NumLike;
  replayDeadline: NumLike;
  sideTotals: NumLike[];
  peak: NumLike;
  maxDecline: NumLike;
  excessAcc: NumLike;
  values: NumLike[];
  scores: NumLike[];
  positionCount: number;
  claimedCount: number;
}

export const PP_SCALE = 1e4;
export const SCORE_SCALE = 1e6;
export const PLAY_DECIMALS = 6;
export const FIRST_PERIOD_ID = 202101;

export const PRODUCTS = [
  { index: 0, key: "cooling", name: "Inflation Cooling", stat: "Largest decline from peak" },
  { index: 1, key: "excess", name: "Excess Inflation", stat: "Accumulated excess above K" },
] as const;

/* Side meaning, assumed from agents/18-planner-screen.md ("product 1 side 0" is the
   cover a hedger buys). Rename here once the program spec confirms the wording.
   Copy rule: never say bet, option, insurance or fair value. */
export const SIDE_LABELS = ["Protection", "Counterparty"] as const;

export const num = (x: NumLike): number => (typeof x === "number" ? x : Number(x.toString()));

export function sessionState(s: SessionLike): "open" | "running" | "settled" | "refunding" {
  const key = (typeof s.state === "string" ? s.state : Object.keys(s.state)[0] ?? "open").toLowerCase();
  if (key === "running" || key === "settled" || key === "refunding") return key;
  return "open";
}

export function stateTone(s: SessionLike): StatusTone {
  return sessionState(s);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function periodLabel(index: number, firstPeriodId = FIRST_PERIOD_ID): string {
  const y0 = Math.floor(firstPeriodId / 100);
  const m0 = (firstPeriodId % 100) - 1;
  const m = m0 + index;
  return `${MONTHS[((m % 12) + 12) % 12]} ${y0 + Math.floor(m / 12)}`;
}

export const fmtPp = (pp: number, digits = 2) => `${pp.toFixed(digits)}%`;
export const fmtScore = (s: number) => s.toFixed(3);
export function fmtPlay(base: NumLike, digits = 2): string {
  const v = num(base) / 10 ** PLAY_DECIMALS;
  return `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} PLAY`;
}
export const shortAddress = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);
export const explorerUrl = (addressOrSig: string, kind: "address" | "tx" = "address", cluster = "devnet") =>
  `https://explorer.solana.com/${kind}/${addressOrSig}?cluster=${cluster}`;

/* PathChart points: observed months carry a value, the rest are null. */
export function pathPoints(s: SessionLike, firstPeriodId = FIRST_PERIOD_ID): PathPoint[] {
  const observed = sessionState(s) === "settled" ? s.nObs : s.nextIndex;
  return s.values.slice(0, s.nObs).map((v, i) => ({
    label: periodLabel(i, firstPeriodId),
    value: i < observed ? num(v) / PP_SCALE : null,
  }));
}

export function yearTicks(nObs: number, firstPeriodId = FIRST_PERIOD_ID) {
  const ticks: Array<{ index: number; label: string }> = [];
  for (let i = 0; i < nObs; i += 12) ticks.push({ index: i, label: String(Math.floor(firstPeriodId / 100) + i / 12) });
  return ticks;
}

export function thresholdLine(s: SessionLike) {
  const v = num(s.k) / PP_SCALE;
  return { value: v, label: `K = ${fmtPp(v)}` };
}

/* Index of the running peak, for a PathChart marker. */
export function peakIndex(s: SessionLike): number {
  const pts = pathPoints(s);
  let best = -1;
  let bestV = -Infinity;
  pts.forEach((p, i) => {
    if (p.value !== null && p.value > bestV) {
      bestV = p.value;
      best = i;
    }
  });
  return best;
}

/* Values for StatCards. */
export function headlineStats(s: SessionLike) {
  const pts = pathPoints(s).filter((p) => p.value !== null);
  const last = pts[pts.length - 1];
  return {
    latest: last ? { value: fmtPp(last.value as number), label: last.label } : null,
    peak: fmtPp(num(s.peak) / PP_SCALE),
    maxDecline: `${(num(s.maxDecline) / PP_SCALE).toFixed(2)} pp`,
    maxDeclineOfCap: num(s.maxDecline) / Math.max(1, num(s.dCap)),
    excess: `${(num(s.excessAcc) / PP_SCALE).toFixed(2)} pp-months`,
    excessOfCap: num(s.excessAcc) / Math.max(1, num(s.aCap)),
    spark: pts.map((p) => p.value as number),
  };
}

/* Scores as fractions, for Meter / ChangeList. Only meaningful once settled. */
export function scoreFractions(s: SessionLike): number[] {
  return s.scores.map((x) => num(x) / SCORE_SCALE);
}

export function scoreRows(s: SessionLike): ChangeRow[] {
  const settled = sessionState(s) === "settled";
  return PRODUCTS.map((p, i) => ({
    label: p.name,
    value: settled ? fmtScore(num(s.scores[i]) / SCORE_SCALE) : "pending",
  }));
}

/* CompositionBar segments: four product × side buckets in fixed order. */
export function sideSegments(s: SessionLike): CompositionSegment[] {
  return s.sideTotals.map((t, i) => ({
    label: `${PRODUCTS[Math.floor(i / 2)].name} · ${SIDE_LABELS[i % 2]}`,
    value: num(t) / 10 ** PLAY_DECIMALS,
  }));
}

export function totalLocked(s: SessionLike): number {
  return s.sideTotals.reduce<number>((acc, t) => acc + num(t), 0);
}

export function replayProgress(s: SessionLike): number {
  return s.nObs ? (sessionState(s) === "settled" ? 1 : s.nextIndex / s.nObs) : 0;
}

export function deadlineLabel(unixSeconds: NumLike): string {
  const d = new Date(num(unixSeconds) * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(-2)}`;
}
