// Port of research/planner.py (exposure-to-contract planner). Same formulas, same tie-break.
// Off-chain research math in floats; matches the Python reference to 1e-6.
import type { Scenario } from "@/lib/artifacts";

export const PRODUCT_ORDER = ["cash", "excess", "fuel"] as const;
export type Product = (typeof PRODUCT_ORDER)[number];
export type Prices = { excess: number; fuel: number };
const STAKE_FRACTIONS = Array.from({ length: 10 }, (_, i) => (i + 1) / 10);

export type Policy = { product: Product; stake: number };
export type Result = {
  product: Product;
  stake: number;
  units: number;
  tail_loss_95: number;
  mean_shortfall: number;
  max_shortfall: number;
  cap_binding_freq: number;
  expected_end_cash: number;
};
export type ShowcaseResult = {
  overrun: number;
  stake: number;
  units: number;
  payout: number;
  remaining_cash: number;
  shortfall: number;
  cash_baseline_shortfall: number;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Python round(x, 10). */
const round10 = (x: number) => Math.round(x * 1e10) / 1e10;

export function shortfall(L: number, B: number, c: number, H: number): number {
  return Math.max(L - (B - c) - H, 0);
}

export function tailMean(values: number[], alpha = 0.05): number {
  const n = Math.max(1, Math.ceil(alpha * values.length));
  return sum([...values].sort((a, b) => b - a).slice(0, n)) / n;
}

const scoreOf = (s: Scenario, product: Product) =>
  product === "excess" ? s.excess_score : product === "fuel" ? s.fuel_score : 0;

export function evaluate(policy: Policy, scenarios: Scenario[], q: number, B: number, prices: Prices): Result {
  const c = policy.stake;
  if (!(c >= 0 && c <= B)) throw new Error(`stake ${c} outside [0, ${B}]`);
  let units = 0;
  if (policy.product !== "cash") {
    const p = prices[policy.product];
    if (!(p > 0 && p <= 1)) throw new Error(`price ${p} outside (0, 1]`);
    units = c / p;
  }
  const scores = scenarios.map((s) => scoreOf(s, policy.product));
  const Hs = scores.map((sc) => units * sc);
  const Us = scenarios.map((s, i) => shortfall(q * s.fuel_overrun_per_gallon, B, c, Hs[i]));
  return {
    product: policy.product,
    stake: c,
    units,
    tail_loss_95: tailMean(Us),
    mean_shortfall: sum(Us) / Us.length,
    max_shortfall: Math.max(...Us),
    cap_binding_freq: policy.product === "cash" ? 0 : scores.filter((sc) => sc >= 1).length / scores.length,
    expected_end_cash: sum(Hs.map((H) => B - c + H)) / Hs.length,
  };
}

export function policies(B: number, products: Product[] = ["excess", "fuel"]): Policy[] {
  const out: Policy[] = [{ product: "cash", stake: 0 }];
  for (const product of products) for (const f of STAKE_FRACTIONS) out.push({ product, stake: round10(f * B) });
  return out;
}

/** Ranked by TailLoss95, then lower stake, then product order [cash, excess, fuel]; stable like Python's sorted. */
export function recommend(
  scenarios: Scenario[],
  q: number,
  B: number,
  prices: Prices,
  products: Product[] = ["excess", "fuel"],
): { best: Result; ranked: Result[] } {
  const ranked = policies(B, products)
    .map((p) => evaluate(p, scenarios, q, B, prices))
    .sort(
      (a, b) =>
        a.tail_loss_95 - b.tail_loss_95 ||
        a.stake - b.stake ||
        PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product),
    );
  return { best: ranked[0], ranked };
}

/**
 * Input guard for the presentation layer. The ranking itself is unchanged; this only decides
 * whether a result may be shown. Gallons finite and >= 0, budget finite and > 0.
 */
export function checkInputs(q: number, B: number): string | null {
  if (!Number.isFinite(q) || !Number.isFinite(B)) return "Enter numbers for gallons per month and budget.";
  if (q < 0) return "Gallons per month cannot be negative.";
  if (!(B > 0)) return "The illustrative budget must be greater than zero.";
  return null;
}

/** One scenario (e.g. 2021-24) under a frozen policy, with the cash baseline beside it. */
export function showcase(policy: Policy, s: Scenario, q: number, B: number, prices: Prices): ShowcaseResult {
  const L = q * s.fuel_overrun_per_gallon;
  const units = policy.product === "cash" ? 0 : policy.stake / prices[policy.product];
  const H = units * scoreOf(s, policy.product);
  return {
    overrun: L,
    stake: policy.stake,
    units,
    payout: H,
    remaining_cash: B - policy.stake,
    shortfall: shortfall(L, B, policy.stake, H),
    cash_baseline_shortfall: shortfall(L, B, 0, 0),
  };
}
