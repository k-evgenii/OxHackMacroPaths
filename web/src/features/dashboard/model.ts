// Private dashboard adapters. Pure functions over the frozen wire shapes
// (docs/frontend-v2/interfaces.md). Token amounts stay decimal strings / bigint;
// only bounded chart coordinates become numbers.
import {
  fmtPeriod,
  fmtPlay,
  sumAmounts,
  summarizeHolding,
  type AmountSummary,
  type CatalogResponse,
  type CoverView,
  type PositionView,
  type SessionView,
  type WalletActivityItem,
  type WalletOverviewResponse,
} from "@macropaths/client";

export type ProductIndex = 0 | 1;
export const PRODUCT_NAMES: Record<ProductIndex, string> = { 0: "Inflation Cooling", 1: "Excess Inflation" };
/** Display order on the dashboard: Excess Inflation first, then Inflation Cooling. */
export const PRODUCT_ORDER: readonly ProductIndex[] = [1, 0];

/* ------------------------------------------------------------------ balances */

export type BalanceRow =
  | { mint: string; status: "ok"; amount: string; formatted: string }
  | { mint: string; status: "unavailable" };

/** One row per registered mint. Never summed across mints; a failed read is never shown as zero. */
export function balanceRows(overview: WalletOverviewResponse): BalanceRow[] {
  return overview.balances.map((b) =>
    b.read.status === "ok"
      ? { mint: b.mint, status: "ok", amount: b.read.data.amount, formatted: fmtPlay(b.read.data.amount) }
      : { mint: b.mint, status: "unavailable" },
  );
}

/* ------------------------------------------------------------------ holdings */

export type AmountStatus = AmountSummary["status"];

/** Amount label by helper status (product-and-content.md, state-dependent copy). */
export function amountLabel(status: AmountStatus, refunding: boolean): string {
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
      // Kept historically; excluded from available-to-claim totals.
      return refunding ? "Refunded" : "Claimed";
  }
}

export function amountText(s: AmountSummary): string {
  if (s.status === "undetermined" || s.amount === null) return "Not determined yet";
  return fmtPlay(s.amount);
}

export type CoverRow = {
  key: string;
  sessionAddress: string;
  sessionLabel: string;
  mint: string;
  products: string[];
  premiumPaid: string;
  maximumPayout: string;
  summary: AmountSummary;
  refunding: boolean;
};
export type PositionRow = {
  key: string;
  sessionAddress: string;
  sessionLabel: string;
  mint: string;
  totalDeposited: string;
  /** More/Less allocation per product, only non-zero sides. */
  sides: Array<{ product: string; side: "More" | "Less"; deposited: string }>;
  summary: AmountSummary;
  refunding: boolean;
};
export type HoldingsUnavailable = { sessionAddress: string; sessionLabel: string; reason: "read" | "session" };

export type HoldingsModel = {
  covers: CoverRow[];
  positions: PositionRow[];
  unavailable: HoldingsUnavailable[];
  /** Available to claim per mint. `amount` null when some unclaimed holding is undetermined/unavailable. */
  claimable: Array<{ mint: string; amount: string | null }>;
};

export type SessionLookup = (address: string) => { session: SessionView; label: string } | null;

const SIDE_LABELS = ["More", "Less"] as const;

/**
 * Builds the connected user's holdings. Accounts whose owner differs from
 * `overview.owner` are dropped so a reference/previous owner's holding is never
 * displayed for the connected wallet.
 */
export function buildHoldings(overview: WalletOverviewResponse, lookup: SessionLookup): HoldingsModel {
  const covers: CoverRow[] = [];
  const positions: PositionRow[] = [];
  const unavailable: HoldingsUnavailable[] = [];
  const unclaimedByMint = new Map<string, { values: string[]; unknown: boolean }>();

  const bump = (mint: string, value: string | null) => {
    const e = unclaimedByMint.get(mint) ?? { values: [], unknown: false };
    if (value === null) e.unknown = true;
    else e.values.push(value);
    unclaimedByMint.set(mint, e);
  };

  for (const h of overview.holdings) {
    const found = lookup(h.sessionAddress);
    const label = found?.label ?? "Session";
    if (h.read.status !== "ok") {
      unavailable.push({ sessionAddress: h.sessionAddress, sessionLabel: label, reason: "read" });
      continue;
    }
    const position: PositionView | null = h.read.data.position?.owner === overview.owner ? h.read.data.position : null;
    const cover: CoverView | null = h.read.data.cover?.owner === overview.owner ? h.read.data.cover : null;
    if (!position && !cover) continue;
    if (!found) {
      unavailable.push({ sessionAddress: h.sessionAddress, sessionLabel: label, reason: "session" });
      continue;
    }
    const { session } = found;
    const summary = summarizeHolding(session, position, cover);
    const mint = session.playMint;

    if (cover && summary.cover) {
      covers.push({
        key: `${h.sessionAddress}:cover`,
        sessionAddress: h.sessionAddress,
        sessionLabel: label,
        mint,
        products: PRODUCT_ORDER.filter((p) => BigInt(cover.units[p]) > 0n).map((p) => PRODUCT_NAMES[p]),
        premiumPaid: summary.cover.paid,
        maximumPayout: summary.cover.maximumPayout,
        summary: summary.cover,
        refunding: session.state === "Refunding",
      });
      bump(mint, summary.cover.unclaimed);
    }
    if (position && summary.position) {
      const sides: PositionRow["sides"] = [];
      for (const p of PRODUCT_ORDER) {
        for (const s of [0, 1] as const) {
          const v = position.deposited[p * 2 + s];
          if (BigInt(v) > 0n) sides.push({ product: PRODUCT_NAMES[p], side: SIDE_LABELS[s], deposited: v });
        }
      }
      positions.push({
        key: `${h.sessionAddress}:position`,
        sessionAddress: h.sessionAddress,
        sessionLabel: label,
        mint,
        totalDeposited: summary.position.paid,
        sides,
        summary: summary.position,
        refunding: session.state === "Refunding",
      });
      bump(mint, summary.position.unclaimed);
    }
  }

  const claimable = [...unclaimedByMint.entries()].map(([mint, e]) => ({
    mint,
    amount: e.unknown ? null : sumAmounts(e.values),
  }));
  return { covers, positions, unavailable, claimable };
}

/* ------------------------------------------------------------------ catalog */

export function sessionLabel(catalog: CatalogResponse | undefined, address: string): string {
  return catalog?.sessions.find((s) => s.address === address)?.presentation.label ?? "Historical session";
}

/* ------------------------------------------------------------------ session preview */

export function historicalRange(session: SessionView): string | null {
  if (session.path.length === 0) return null;
  const first = session.path[0].periodId;
  const last = session.path[session.path.length - 1].periodId;
  return first === last ? fmtPeriod(first) : `${fmtPeriod(first)} – ${fmtPeriod(last)}`;
}

export function replayStateText(session: SessionView): string {
  switch (session.state) {
    case "Open":
      return session.nextIndex === 0 ? "Open · replay not started" : `Open · ${session.nextIndex} of ${session.nObs} readings`;
    case "Running":
      return `Replaying · ${session.nextIndex} of ${session.nObs} readings`;
    case "Settled":
      return "Settled";
    case "Refunding":
      return "Refunding";
  }
}

/** Last replay reading with its historical month, or null before the first observation. */
export function lastReading(session: SessionView): { value: string; month: string } | null {
  const row = session.path[session.path.length - 1];
  return row ? { value: row.value, month: fmtPeriod(row.periodId) } : null;
}

/** Bounded plotting coordinate in percentage points; display text comes from exact formatters. */
export function ppCoordinate(v: string): number {
  return Number(BigInt(v)) / 1e4;
}

/**
 * Per-observation product score path (millionths as string) derived from the recorded
 * running statistics: cooling = maxDecline/dCap, excess = excessAcc/aCap, capped at 1.
 */
export function scorePath(session: SessionView, product: ProductIndex): Array<{ periodId: number; score: string }> {
  const cap = BigInt(product === 0 ? session.terms.dCap : session.terms.aCap);
  if (cap <= 0n) return [];
  return session.path.map((row) => {
    const stat = BigInt(product === 0 ? row.decline : row.excess);
    const clamped = stat < 0n ? 0n : stat > cap ? cap : stat;
    return { periodId: row.periodId, score: ((clamped * 1_000_000n) / cap).toString() };
  });
}

/* ------------------------------------------------------------------ activity */

export const ACTIVITY_TITLES: Record<WalletActivityItem["kind"], string> = {
  CoverBought: "Cover purchased",
  PoolDeposit: "Pool deposit",
  CoverPayout: "Cover payout",
  PoolPayout: "Pool payout",
  Refund: "Refund",
};

export type ActivityRow = {
  id: string;
  title: string;
  context: string;
  when: string;
  amount: string;
  direction: "in" | "out" | "zero" | "unknown";
  explorerUrl: string;
};

export function signedPlay(amount: string | null): { text: string; direction: ActivityRow["direction"] } {
  if (amount === null) return { text: "Amount unavailable", direction: "unknown" };
  const n = BigInt(amount);
  if (n === 0n) return { text: fmtPlay(amount), direction: "zero" };
  return n > 0n ? { text: `+${fmtPlay(amount)}`, direction: "in" } : { text: fmtPlay(amount), direction: "out" };
}

export function explorerTxUrl(signature: string, cluster: string): string {
  const c = cluster === "mainnet-beta" ? "" : `?cluster=${encodeURIComponent(cluster)}`;
  return `https://explorer.solana.com/tx/${signature}${c}`;
}

export function activityRows(
  items: readonly WalletActivityItem[],
  opts: { limit: number; cluster: string; labelFor: (session: string) => string; formatTime?: (unix: number) => string },
): ActivityRow[] {
  const fmt = opts.formatTime ?? ((t: number) => new Date(t * 1000).toLocaleString());
  return items.slice(0, opts.limit).map((it) => {
    const { text, direction } = signedPlay(it.amount);
    const product = it.product === null ? "Both products" : PRODUCT_NAMES[it.product];
    return {
      id: it.id,
      title: ACTIVITY_TITLES[it.kind],
      context: `${opts.labelFor(it.session)} · ${product}`,
      when: it.blockTime === null ? "Date unavailable" : fmt(it.blockTime),
      amount: text,
      direction,
      explorerUrl: explorerTxUrl(it.signature, opts.cluster),
    };
  });
}
