// Pure presentation model for the Activity page. No network, no Date.now() reads:
// callers pass `now`, locale and the browser time zone so tests can pin them.
import { fmtPeriod, fmtPlay, fmtPp } from "@macropaths/client";

// Structural mirrors of the frozen wire types (docs/frontend-v2/interfaces.md).
// They are assignable from the shared zod-inferred types once the foundation lands.
export type ActivityKind = "PoolDeposit" | "CoverBought" | "PoolPayout" | "CoverPayout" | "Refund";
export type WalletActivityItemLike = {
  id: string;
  signature: string;
  instructionIndex: number;
  innerInstructionIndex: number | null;
  session: string;
  product: 0 | 1 | null;
  slot: number;
  blockTime: number | null;
  kind: ActivityKind;
  amount: string | null;
  mint: string;
};
export type WalletActivityPageLike = {
  nextBefore: string | null;
  pending: string[];
  retryCursor: string | null;
  items: WalletActivityItemLike[];
};
export type PathRowLike = { i: number; periodId: number; value: string };
export type SessionLike = {
  state: "Open" | "Running" | "Settled" | "Refunding";
  nObs: number;
  nextIndex: number;
  path: PathRowLike[];
};

export const KIND_TITLE: Record<ActivityKind, string> = {
  CoverBought: "Cover purchased",
  PoolDeposit: "Pool deposit",
  CoverPayout: "Cover payout",
  PoolPayout: "Pool payout",
  Refund: "Refund",
};

const PRODUCT_NAME = ["Inflation Cooling", "Excess Inflation"] as const;

export function productLabel(product: 0 | 1 | null): string {
  return product === null ? "Both products" : PRODUCT_NAME[product];
}

export type AmountDisplay = { text: string; direction: "in" | "out" | "zero" | "unknown" };

/** Exact signed PLAY formatting (6 decimals = base-unit precision). Null is never zero. */
export function formatSignedAmount(amount: string | null): AmountDisplay {
  if (amount === null) return { text: "Amount unavailable", direction: "unknown" };
  const n = BigInt(amount);
  if (n === 0n) return { text: fmtPlay(0n, 6), direction: "zero" };
  const abs = fmtPlay(n < 0n ? -n : n, 6);
  return n < 0n ? { text: `−${abs}`, direction: "out" } : { text: `+${abs}`, direction: "in" };
}

// ---------- pages ----------

export type FeedModel = {
  items: WalletActivityItemLike[];
  pendingCount: number;
  /** cursor for the next older page; independent of how many rows a page had */
  nextBefore: string | null;
  /** the newest-loaded (last) page matched nothing but history continues */
  lastPageEmptyWithContinuation: boolean;
  reachedEnd: boolean;
};

/** Flatten loaded pages, keeping the first occurrence of each stable action id. */
export function buildFeed(pages: readonly WalletActivityPageLike[]): FeedModel {
  const seen = new Set<string>();
  const items: WalletActivityItemLike[] = [];
  const pending = new Set<string>();
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    for (const sig of page.pending) pending.add(sig);
  }
  const last = pages.at(-1);
  const nextBefore = last?.nextBefore ?? null;
  return {
    items,
    pendingCount: pending.size,
    nextBefore,
    lastPageEmptyWithContinuation: !!last && last.items.length === 0 && nextBefore !== null,
    reachedEnd: !!last && nextBefore === null,
  };
}

// ---------- dates ----------

export type DayGroup = { key: string; label: string; items: WalletActivityItemLike[] };
export const DATE_UNAVAILABLE = "Date unavailable";

function dayKey(d: Date, timeZone?: string): string {
  // en-CA gives YYYY-MM-DD in the requested (or browser) time zone.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function previousDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.toISOString().slice(0, 10);
}

/**
 * Group by calendar day in the browser time zone (Today, Yesterday, then the date),
 * newest day first; items with no block time go last under "Date unavailable".
 * Order inside a group is the API order (stable).
 */
export function groupByDay(
  items: readonly WalletActivityItemLike[],
  now: Date,
  opts: { locale?: string; timeZone?: string } = {},
): DayGroup[] {
  const today = dayKey(now, opts.timeZone);
  const yesterday = previousDayKey(today);
  const groups = new Map<string, DayGroup>();
  const unknown: WalletActivityItemLike[] = [];
  for (const item of items) {
    if (item.blockTime === null) {
      unknown.push(item);
      continue;
    }
    const d = new Date(item.blockTime * 1000);
    const key = dayKey(d, opts.timeZone);
    let g = groups.get(key);
    if (!g) {
      const label =
        key === today
          ? "Today"
          : key === yesterday
            ? "Yesterday"
            : new Intl.DateTimeFormat(opts.locale, {
                timeZone: opts.timeZone,
                year: "numeric",
                month: "short",
                day: "numeric",
              }).format(d);
      g = { key, label, items: [] };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  const out = [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  if (unknown.length) out.push({ key: "unknown", label: DATE_UNAVAILABLE, items: unknown });
  return out;
}

export function formatTime(blockTime: number | null, opts: { locale?: string; timeZone?: string } = {}): string {
  if (blockTime === null) return "Time unavailable";
  return new Intl.DateTimeFormat(opts.locale, { timeZone: opts.timeZone, hour: "numeric", minute: "2-digit" }).format(
    new Date(blockTime * 1000),
  );
}

// ---------- market ----------

export type MarketRow = { id: string; index: number; month: string; label: string };
export type MarketSummary = { title: string; description: string } | null;

/** Accepted observations only, newest first by recorded index. Never padded from reference data. */
export function marketRows(session: SessionLike): MarketRow[] {
  return [...session.path]
    .sort((a, b) => b.i - a.i)
    .map((r) => {
      const month = fmtPeriod(r.periodId);
      return { id: `obs-${r.i}`, index: r.i, month, label: `${month} recorded: ${fmtPp(r.value)}` };
    });
}

export function marketSummary(session: SessionLike): MarketSummary {
  const recorded = `${session.path.length} of ${session.nObs} observations recorded`;
  switch (session.state) {
    case "Settled":
      return { title: "Replay complete — session settled", description: `${recorded}. Payouts are final.` };
    case "Refunding":
      return { title: "Session refunding", description: `${recorded}. Deposits and premiums are refundable.` };
    case "Running":
      return { title: "Replay in progress", description: `${recorded} so far.` };
    case "Open":
      return session.path.length === 0
        ? { title: "Not started", description: "No observations have been recorded yet." }
        : null;
  }
}

// ---------- errors ----------

export type FeedErrorKind = "expired" | "generic";
/** A 400 from a retry/before cursor means the 15-minute snapshot is gone: offer a refresh. */
export function classifyFeedError(error: unknown): FeedErrorKind {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 400 ? "expired" : "generic";
}
