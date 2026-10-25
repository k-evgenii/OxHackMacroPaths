// FROZEN CONTRACT between packages/client, the API routes and the web pages.
// Owner: integrator. Agents must not edit this file; request changes in your hand-off.
//
// Conventions
// - Every u64/i64 chain value is a decimal string (lossless). u8/u32 values are numbers.
// - Raw chain units are kept; formatting lives in format.ts.
//   values, k, peak, maxDecline, dCap: 1e-4 percentage points (32500 = 3.25 %)
//   excessAcc, aCap: 1e-4 pp-months
//   scores, quote prices: millionths (1_000_000 = 1)
//   token amounts: PLAY base units, 6 decimals
// - Side index j = product * 2 + side. Product 0 = Inflation Cooling, 1 = Excess Inflation.
//   Side 0 = "more", side 1 = "less".
// - 32-byte hashes (datasetId, commitment, terminal) are lowercase hex.
import { z } from "zod";

export const U64 = z.string().regex(/^\d+$/, "u64 decimal string");
export const I64 = z.string().regex(/^-?\d+$/, "i64 decimal string");
export const Pubkey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "base58 pubkey");
export const Hex32 = z.string().regex(/^[0-9a-f]{64}$/, "32-byte hex");
const tuple2 = <T extends z.ZodTypeAny>(t: T) => z.tuple([t, t]);
const tuple4 = <T extends z.ZodTypeAny>(t: T) => z.tuple([t, t, t, t]);

export const SessionState = z.enum(["Open", "Running", "Settled", "Refunding"]);
export type SessionState = z.infer<typeof SessionState>;

/** One accepted observation, with the running statistics recomputed by math.ts. */
export const PathRow = z.object({
  i: z.number().int().min(0).max(47),
  /** YYYYMM. Derived as consecutive months ending at lastPeriodId; Observed events carry the exact id. */
  periodId: z.number().int(),
  value: I64,
  peak: I64,
  decline: I64,
  excess: I64,
});
export type PathRow = z.infer<typeof PathRow>;

export const SessionView = z.object({
  address: Pubkey,
  sessionId: U64,
  authority: Pubkey,
  playMint: Pubkey,
  vaults: tuple2(Pubkey),
  state: SessionState,
  datasetId: Hex32,
  commitment: Hex32,
  terminal: Hex32,
  /** commitment == terminal and nextIndex == nObs */
  integrityOk: z.boolean(),
  nObs: z.number().int(),
  nextIndex: z.number().int(),
  lastPeriodId: z.number().int(),
  terms: z.object({ k: I64, dCap: I64, aCap: I64 }),
  /** unix seconds */
  depositDeadline: z.number().int(),
  replayDeadline: z.number().int(),
  sideTotals: tuple4(U64),
  matched: tuple2(U64),
  /** peak is null before the first observation (i64::MIN on chain) */
  stats: z.object({ peak: I64.nullable(), maxDecline: I64, excessAcc: I64 }),
  scores: tuple2(U64),
  pBudget: tuple4(U64),
  rBudget: tuple4(U64),
  counts: z.object({
    positions: z.number().int(),
    claimed: z.number().int(),
    covers: z.number().int(),
    coversClaimed: z.number().int(),
    sellerProductsOpen: z.number().int(),
  }),
  /** length == nextIndex */
  path: z.array(PathRow),
});
export type SessionView = z.infer<typeof SessionView>;

export const SessionSummary = SessionView.pick({
  address: true,
  sessionId: true,
  authority: true,
  state: true,
  nObs: true,
  nextIndex: true,
  scores: true,
  sideTotals: true,
  depositDeadline: true,
  replayDeadline: true,
});
export type SessionSummary = z.infer<typeof SessionSummary>;
export const SessionList = z.object({ sessions: z.array(SessionSummary) });
export type SessionList = z.infer<typeof SessionList>;

/** payout: per side, claim_amount when Settled, deposits when Refunding, null otherwise. */
export const PositionView = z.object({
  address: Pubkey,
  owner: Pubkey,
  deposited: tuple4(U64),
  claimed: z.boolean(),
  payout: tuple4(U64).nullable(),
});
export type PositionView = z.infer<typeof PositionView>;

/** payout: per product floor(score*units/1e6) when Settled, premiumPaid when Refunding, null otherwise. */
export const CoverView = z.object({
  address: Pubkey,
  owner: Pubkey,
  units: tuple2(U64),
  premiumPaid: tuple2(U64),
  claimed: z.boolean(),
  payout: tuple2(U64).nullable(),
});
export type CoverView = z.infer<typeof CoverView>;

export const PositionsResponse = z.object({
  positions: z.array(PositionView),
  covers: z.array(CoverView),
});
export type PositionsResponse = z.infer<typeof PositionsResponse>;

export const EntryQuoteView = z.object({
  address: Pubkey,
  p: tuple2(U64),
  isSet: z.boolean(),
  frozen: z.boolean(),
});
export type EntryQuoteView = z.infer<typeof EntryQuoteView>;

export const SellerView = z.object({
  address: Pubkey,
  seller: Pubkey,
  freeCash: U64,
  escrow: tuple2(U64),
  nSold: tuple2(U64),
  premium: tuple2(U64),
  settled: tuple2(z.boolean()),
});
export type SellerView = z.infer<typeof SellerView>;

/** Either part may be null when the account does not exist. */
export const SellerResponse = z.object({
  seller: SellerView.nullable(),
  quote: EntryQuoteView.nullable(),
});
export type SellerResponse = z.infer<typeof SellerResponse>;

const EventBase = {
  signature: z.string(),
  slot: z.number().int(),
  blockTime: z.number().int().nullable(),
  /** Session carried in the emitted event data (never inferred from a request URL). */
  session: Pubkey,
  /** Index among all parsed MacroPaths events of this transaction, in log order (before any session filter). */
  eventIndex: z.number().int().nonnegative(),
};
export const EventView = z.discriminatedUnion("type", [
  z.object({
    ...EventBase,
    type: z.literal("Observed"),
    data: z.object({
      index: z.number().int(),
      periodId: z.number().int(),
      value: I64,
      peak: I64,
      maxDecline: I64,
      excessAcc: I64,
      commitment: Hex32,
    }),
  }),
  z.object({
    ...EventBase,
    type: z.literal("Settled"),
    data: z.object({
      scores: tuple2(U64),
      matched: tuple2(U64),
      pBudget: tuple4(U64),
      rBudget: tuple4(U64),
    }),
  }),
  z.object({
    ...EventBase,
    type: z.literal("Claimed"),
    data: z.object({ owner: Pubkey, amounts: tuple2(U64), refund: z.boolean() }),
  }),
  z.object({
    ...EventBase,
    type: z.literal("CoverBought"),
    data: z.object({
      owner: Pubkey,
      product: z.number().int(),
      units: U64,
      buyerPaid: U64,
      sellerPaid: U64,
    }),
  }),
]);
export type EventView = z.infer<typeof EventView>;

/**
 * nextBefore: last scanned signature (pass as ?before=), null at the end.
 * pending: signatures whose transaction could not be hydrated yet. retryCursor: opaque retry token or null.
 */
export const HistoryPageMeta = z.object({
  nextBefore: z.string().nullable(),
  pending: z.array(z.string()),
  retryCursor: z.string().nullable(),
});
export type HistoryPageMeta = z.infer<typeof HistoryPageMeta>;

/** Newest first. */
export const EventsResponse = HistoryPageMeta.extend({ events: z.array(EventView) });
export type EventsResponse = z.infer<typeof EventsResponse>;

export const Health = z.object({
  cluster: z.string(),
  slot: z.number().int(),
  programId: Pubkey,
  executable: z.boolean(),
});
export type Health = z.infer<typeof Health>;

/** Error body for every non-2xx API response. */
export const ApiError = z.object({
  error: z.string(),
  code: z.enum(["bad_request", "not_found", "rpc_error", "internal"]),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------------------------------------------------------------------------------------------
// Frontend v2 contracts (docs/frontend-v2/interfaces.md, pack version 1). Foundation declarations;
// worker 01 owns hardening. Amounts are decimal-integer strings (U64/I64); never Number.
// ---------------------------------------------------------------------------------------------

export const ReadMeta = z.object({
  source: z.enum(["rpc", "fixture"]),
  fetchedAt: z.string(),
});
export type ReadMeta = z.infer<typeof ReadMeta>;

/** Optional section: read successfully (data may still contain nulls for missing accounts) or unavailable. */
export const ReadSection = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), data }),
    z.object({ status: z.literal("unavailable"), data: z.null() }),
  ]);
export type ReadSection<T> = { status: "ok"; data: T } | { status: "unavailable"; data: null };

export const SessionPresentationMetadata = z.object({
  label: z.string(),
  mode: z.literal("historical_replay"),
  layout: z.literal("v1"),
  firstPeriodId: z.number().int(),
  researchBundleId: z.string().nullable(),
});
export type SessionPresentationMetadata = z.infer<typeof SessionPresentationMetadata>;

export const ProductKey = z.enum(["cooling", "excess", "fuel"]);
export type ProductKey = z.infer<typeof ProductKey>;

export const CatalogResponse = z.object({
  version: z.literal(1),
  cluster: z.string(),
  defaultSession: Pubkey,
  sessions: z.array(z.object({ address: Pubkey, presentation: SessionPresentationMetadata })),
  products: z.array(
    z.object({
      key: ProductKey,
      name: z.string(),
      description: z.string(),
      status: z.enum(["supported", "research"]),
      productIndex: z.union([z.literal(0), z.literal(1)]).nullable(),
    }),
  ),
  research: z.object({ bundleId: z.string(), path: z.literal("/api/artifacts/bundle") }).nullable(),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;

export const CoverOfferStatus = z.enum(["available", "not_configured", "closed", "unfunded"]);
export type CoverOfferStatus = z.infer<typeof CoverOfferStatus>;

export const SessionOverviewResponse = z.object({
  session: SessionView,
  meta: ReadMeta,
  presentation: SessionPresentationMetadata,
  derived: z.object({ currentScores: tuple2(U64).nullable(), poolDeposited: U64 }),
  vault: ReadSection(z.object({ amounts: tuple2(U64), total: U64 })),
  coverOffer: ReadSection(
    z.object({
      seller: SellerView.nullable(),
      quote: EntryQuoteView.nullable(),
      status: CoverOfferStatus,
    }),
  ),
});
export type SessionOverviewResponse = z.infer<typeof SessionOverviewResponse>;

export const WalletOverviewResponse = z.object({
  owner: Pubkey,
  meta: ReadMeta,
  balances: z.array(z.object({ mint: Pubkey, read: ReadSection(z.object({ amount: U64 })) })),
  holdings: z.array(
    z.object({
      sessionAddress: Pubkey,
      read: ReadSection(z.object({ position: PositionView.nullable(), cover: CoverView.nullable() })),
    }),
  ),
});
export type WalletOverviewResponse = z.infer<typeof WalletOverviewResponse>;

export const WalletActivityKind = z.enum(["PoolDeposit", "CoverBought", "PoolPayout", "CoverPayout", "Refund"]);
export type WalletActivityKind = z.infer<typeof WalletActivityKind>;

export const WalletActivityItem = z.object({
  /** `${signature}:${instructionIndex}:${innerInstructionIndex ?? 'top'}:${kind}` */
  id: z.string(),
  signature: z.string(),
  instructionIndex: z.number().int().nonnegative(),
  innerInstructionIndex: z.number().int().nonnegative().nullable(),
  session: Pubkey,
  product: z.union([z.literal(0), z.literal(1)]).nullable(),
  slot: z.number().int(),
  blockTime: z.number().int().nullable(),
  kind: WalletActivityKind,
  /** signed: outgoing < 0, incoming > 0, genuine zero allowed; null = attribution inconclusive */
  amount: I64.nullable(),
  mint: Pubkey,
});
export type WalletActivityItem = z.infer<typeof WalletActivityItem>;

export const WalletActivityResponse = HistoryPageMeta.extend({ items: z.array(WalletActivityItem) });
export type WalletActivityResponse = z.infer<typeof WalletActivityResponse>;

/** Stable wallet-activity action id. */
export function walletActivityId(
  i: Pick<WalletActivityItem, "signature" | "instructionIndex" | "innerInstructionIndex" | "kind">,
): string {
  return `${i.signature}:${i.instructionIndex}:${i.innerInstructionIndex ?? "top"}:${i.kind}`;
}

// ---- research artifacts (moved from web/src/lib/artifacts.ts; legacy fields preserved) ----

export const ManifestProduct = z.object({
  index: z.number().nullable(),
  key: z.string(),
  name: z.string(),
  stat: z.string(),
  row: z.string(),
  k: z.number().nullable(),
  cap: z.number(),
  cap_units: z.string(),
  windows: z.number(),
  first_window: z.string(),
  last_window: z.string(),
  executable: z.boolean(),
  note: z.string().optional(),
});
export type ManifestProduct = z.infer<typeof ManifestProduct>;

const StatScore = z.object({ stat: z.number(), score: z.number() });
const Snapshot = z.object({ retrieved_at: z.string() });
export const Manifest = z.object({
  version: z.number(),
  // Source snapshots the artefacts were computed from; retrieved_at is the data date shown on research screens.
  snapshots: z.record(Snapshot).optional(),
  products: z.array(ManifestProduct),
  showcase: z.object({
    window: z.tuple([z.string(), z.string()]),
    cooling: StatScore,
    excess: StatScore,
    fuel: StatScore.extend({ months_above_k: z.number().optional() }),
  }),
  one: z.number(),
});
export type Manifest = z.infer<typeof Manifest>;

export const Fit = z.object({
  a: z.number(),
  b: z.number(),
  resid_sd: z.number(),
  n: z.number(),
  fit_window: z.tuple([z.string(), z.string()]),
  half_life_months: z.number(),
});
export type Fit = z.infer<typeof Fit>;
const Cell = z.object({ V: z.number(), sigma: z.number() });

export const Forecast = z.object({
  manifest_version: z.number().optional(),
  model: z.string(),
  seed: z.number().optional(),
  n_paths: z.number(),
  fit: z.object({ cpi: Fit, fuel: Fit }),
  quotes: z.object({
    p: z.array(z.number()),
    products: z.array(z.string()),
    formula: z.string(),
    fuel_research_quote: z.number(),
  }),
  label: z.string(),
  // The terminal row (t = 48, the realised end state) has no calendar period: period_id is null there.
  rows: z.array(z.object({ t: z.number(), period_id: z.number().nullable(), cooling: Cell, excess: Cell, fuel: Cell })),
});
export type Forecast = z.infer<typeof Forecast>;

export const Scenario = z.object({
  start: z.string(),
  excess_score: z.number(),
  fuel_score: z.number(),
  fuel_overrun_per_gallon: z.number(),
});
export type Scenario = z.infer<typeof Scenario>;

const ResultRow = z.object({
  product: z.enum(["cash", "excess", "fuel"]),
  stake: z.number(),
  units: z.number(),
  tail_loss_95: z.number(),
  mean_shortfall: z.number(),
  max_shortfall: z.number(),
  cap_binding_freq: z.number(),
  expected_end_cash: z.number(),
});

const PlannerShowcase = z.object({
  overrun: z.number(),
  stake: z.number(),
  units: z.number(),
  payout: z.number(),
  remaining_cash: z.number(),
  shortfall: z.number(),
  cash_baseline_shortfall: z.number(),
});

export const PlannerArtifact = z.object({
  manifest_version: z.number().optional(),
  prices: z.object({ excess: z.number(), fuel: z.number() }),
  caps: z.object({ cooling: z.number(), excess: z.number(), fuel: z.number() }),
  thresholds: z.object({ excess_k_1e4pp: z.number(), fuel_k_1e4usd: z.number() }),
  scenario_note: z.string(),
  defaults: z.object({ q: z.number(), G: z.number(), B: z.number() }),
  scenarios: z.array(Scenario),
  showcase: Scenario.extend({ under_recommended: PlannerShowcase }),
  default_recommendation: ResultRow,
  default_table: z.array(ResultRow),
});
export type PlannerArtifact = z.infer<typeof PlannerArtifact>;

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex");

export const ResearchTerm = z.object({
  key: ProductKey,
  threshold: I64.nullable(),
  cap: U64,
  units: z.enum(["1e-4-pp", "1e-4-pp-months", "1e-4-usd-months"]),
  quoteMillionths: U64,
  researchOnly: z.boolean(),
});
export type ResearchTerm = z.infer<typeof ResearchTerm>;

export const ResearchBundle = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  metadata: z.object({
    generatedAt: z.string().nullable(),
    modelCurrency: z.literal("USD"),
    moneyMeaning: z.literal("illustrative"),
    hashes: z.object({ manifest: Sha256Hex, forecast: Sha256Hex, planner: Sha256Hex }),
    associatedSession: Pubkey.nullable(),
  }),
  terms: z.array(ResearchTerm),
  manifest: Manifest,
  forecast: Forecast,
  planner: PlannerArtifact,
});
export type ResearchBundle = z.infer<typeof ResearchBundle>;
