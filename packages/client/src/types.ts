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

/** Newest first. nextBefore is the signature to pass as ?before= for the next page, or null at the end. */
export const EventsResponse = z.object({
  events: z.array(EventView),
  nextBefore: z.string().nullable(),
});
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
