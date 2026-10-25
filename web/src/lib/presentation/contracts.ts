// Optional web-only presentation adapter types (frozen, coordinator/15). Types only; no account decoding.
// Exact amount models come from @macropaths/client (AmountSummary, HoldingSummary, sumAmounts, ...).
import type { AmountSummary, HoldingSummary, ProductKey } from "@macropaths/client";

export type { AmountSummary, HoldingSummary };

/** Where a displayed value came from; never mix session results with research results. */
export type ValueProvenance = "session" | "research" | "wallet";

/** A display-ready value: `text` is exact caller formatting; `raw` keeps the decimal string. */
export type DisplayAmount = { text: string; raw: string | null };

/** Common state of an adapter-produced section. Descriptions are safe text, never raw Errors/URLs. */
export type SectionState<T> =
  | { kind: "loading" }
  | { kind: "ready"; value: T; stale?: boolean }
  | { kind: "unavailable"; description: string; onRetry?: () => void }
  | { kind: "error"; description: string; onRetry?: () => void };

export type ProductLabel = { key: ProductKey; name: string; research: boolean };
