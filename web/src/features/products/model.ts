// Pure presentation models for Products and the Planner. No React, no fetching, no token math.
// Research numbers are illustrative USD floats; on-chain amounts stay decimal strings and are
// formatted by the shared exact helpers passed in by the caller.
import type { PlannerArtifact } from "@/lib/artifacts";
import { checkInputs, recommend, showcase, type Product, type Result, type ShowcaseResult } from "@/lib/planner";

export const RESEARCH_USD_NOTE =
  "Research calculations use illustrative USD amounts. Devnet holdings use PLAY; no conversion rate is assumed.";

export const PRODUCT_COPY = {
  excess: {
    name: "Excess Inflation",
    description: "Pays according to how far and how long inflation stays above the session's threshold.",
  },
  cooling: {
    name: "Inflation Cooling",
    description:
      "Pays according to the largest decline in inflation from an earlier peak. A view on inflation, not a promise that it matches a particular bill.",
  },
  fuel: {
    name: "Fuel Research",
    description: "Research illustration of a contract linked more directly to a gasoline bill.",
  },
} as const;

export const PLANNER_NAME: Record<Product, string> = {
  cash: "Keep cash",
  excess: "Excess Inflation",
  fuel: "Fuel Research",
};

// ---------------------------------------------------------------- cover offers

/** Structural mirror of SessionOverviewResponse["coverOffer"] (interfaces.md). */
export type CoverOfferSection =
  | {
      status: "ok";
      data: {
        seller: { freeCash: string } | null;
        quote: { p: [string, string]; isSet: boolean } | null;
        status: "available" | "not_configured" | "closed" | "unfunded";
      };
    }
  | { status: "unavailable"; data: null };

export type OfferState = "available" | "not_configured" | "closed" | "unfunded" | "unavailable";

export type OfferView = {
  state: OfferState;
  title: string;
  description: string;
  /** Raw on-chain millionths for the product, only when an offer is available. */
  quoteMillionths: string | null;
  /** Always explains why there is no buy action in this release. */
  actionNote: string;
};

export const NO_TRANSACTIONS =
  "Buying is not available in this release: the app reads data and connects wallets but does not send transactions.";

/**
 * Offer copy for one CPI product index. Never substitutes a research/model price: when the
 * on-chain offer is not available, quoteMillionths is null and the copy says why.
 */
export function offerView(section: CoverOfferSection | undefined, productIndex: 0 | 1, settled: boolean): OfferView {
  const base = { quoteMillionths: null, actionNote: NO_TRANSACTIONS };
  if (!section || section.status === "unavailable")
    return {
      ...base,
      state: "unavailable",
      title: "Offer could not be read",
      description: "The seller and quote accounts could not be read right now. This is not the same as no offer.",
    };
  const { status, quote } = section.data;
  if (status === "closed")
    return {
      ...base,
      state: "closed",
      title: settled ? "Historical session" : "Offer window closed",
      description: settled
        ? "This session has settled. Its terms are shown as history; no new cover can be bought."
        : "The entry window for this session has closed.",
    };
  if (status === "not_configured")
    return {
      ...base,
      state: "not_configured",
      title: "No seller quote",
      description: "No seller quote is set for this session, so there is no on-chain price to show.",
    };
  if (status === "unfunded")
    return {
      ...base,
      state: "unfunded",
      title: "No seller funds available",
      description: "A quote exists but no seller funds are available to back new cover.",
    };
  return {
    ...base,
    state: "available",
    title: "Seller offer",
    description: "Price is PLAY per 1 PLAY of maximum payout. It is a price, not a chance of payout.",
    quoteMillionths: quote ? quote.p[productIndex] : null,
  };
}

// ---------------------------------------------------------------- planner

export type PlanInputs = { gallons: number; budget: number };

export type ChartPoint = { id: string; x: number; value: number | null; label: string; formattedValue: string };
export type ChartSeries = { id: string; label: string; points: ChartPoint[]; tone?: "primary" | "secondary" };

export type PlanView =
  | { status: "invalid"; error: string }
  | {
      status: "ok";
      best: Result;
      cash: Result;
      ranked: Result[];
      showcase: ShowcaseResult;
      showcaseWindow: string;
      sentence: string;
      cashWins: boolean;
      zeroExposure: boolean;
      tailNote: string;
      chart: { title: string; summary: string; series: ChartSeries[]; threshold: { value: number; label: string } };
      windows: number;
    };

export const usd = (v: number, digits = 2) =>
  `USD ${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pct = (v: number) => `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;

export function planView(art: PlannerArtifact, { gallons, budget }: PlanInputs): PlanView {
  const error = checkInputs(gallons, budget);
  if (error) return { status: "invalid", error };
  const { best, ranked } = recommend(art.scenarios, gallons, budget, art.prices);
  const cash = ranked.find((r) => r.product === "cash")!;
  const show = showcase(best, art.showcase, gallons, budget, art.prices);
  const cashWins = best.product === "cash";
  const zeroExposure = gallons === 0;
  const start = art.showcase.start;
  const showcaseWindow = `${start}, 48 months`;

  const sentence = cashWins
    ? zeroExposure
      ? "With no fuel exposure, keep the illustrative budget as cash; no cover lowers a shortfall that does not exist."
      : `Keep the full ${usd(budget)} as cash: no tested allocation lowered the historical tail shortfall.`
    : `Put ${usd(best.stake)} of the ${usd(budget)} illustrative budget into ${PLANNER_NAME[best.product]} and keep ${usd(budget - best.stake)} as cash.`;

  const tailNote =
    best.tail_loss_95 === 0
      ? "A zero historical tail shortfall is a property of this overlapping sample, not guaranteed protection."
      : "Tail shortfall is the average of the worst 5% of historical windows.";

  const series: ChartSeries[] = (["fuel", "excess"] as const)
    .filter((p) => ranked.some((r) => r.product === p))
    .map((p, i) => ({
      id: p,
      label: PLANNER_NAME[p],
      tone: i === 0 ? "primary" : "secondary",
      points: [cash, ...ranked.filter((r) => r.product === p).sort((a, b) => a.stake - b.stake)].map((r) => ({
        id: `${p}-${r.stake}`,
        x: r.stake,
        value: r.tail_loss_95,
        label: `${PLANNER_NAME[p]}, allocation ${usd(r.stake)}`,
        formattedValue: usd(r.tail_loss_95),
      })),
    }));

  const summary =
    `Historical worst-5% average shortfall by allocation. Cash only: ${usd(cash.tail_loss_95)}. ` +
    series
      .map((s) => {
        const last = s.points[s.points.length - 1];
        return `${s.label} at full budget: ${last.formattedValue}`;
      })
      .join(". ") +
    `. Recommended: ${cashWins ? "cash" : `${PLANNER_NAME[best.product]} at ${usd(best.stake)}`}, ${usd(best.tail_loss_95)}.`;

  return {
    status: "ok",
    best,
    cash,
    ranked,
    showcase: show,
    showcaseWindow,
    sentence,
    cashWins,
    zeroExposure,
    tailNote,
    windows: art.scenarios.length,
    chart: {
      title: "Budget allocation versus historical tail shortfall",
      summary,
      series,
      threshold: { value: cash.tail_loss_95, label: `Cash only ${usd(cash.tail_loss_95)}` },
    },
  };
}

export const capBindingText = (r: Result) => (r.product === "cash" ? "n/a" : pct(r.cap_binding_freq));

export const METHODOLOGY = [
  "Each of the 21 allocations (cash, or 10% to 100% of the budget in Excess Inflation or Fuel Research) is replayed over every historical 48-month window.",
  "Shortfall is the fuel overrun not covered by remaining cash plus the modelled payout. The worst-5% average shortfall is the mean of the worst 5% of windows.",
  "Ranking: smaller worst-5% average shortfall, then smaller allocation, then cash before Excess Inflation before Fuel Research.",
  "The windows overlap, so they are not independent future trials and the result is not a calibrated probability.",
  "Payouts are capped: a large overrun can still leave part of the bill uncovered. Excess Inflation follows CPI, not gasoline, so it can miss a fuel-specific spike (basis mismatch).",
  "Prices and caps are research references from the model bundle, not a live seller quote and not any on-chain session's terms.",
];
