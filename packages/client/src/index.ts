// Public surface of @macropaths/client. Signatures are FROZEN (integrator-owned).
export * from "./types";
export {
  IDL,
  PROGRAM_ID,
  N_OBS,
  ONE,
  PLAY_DECIMALS,
  PRODUCT_NAMES,
  SIDE_NAMES,
  ACCOUNT_DISCRIMINATORS,
  SESSION_FIELD_OFFSET,
  SEEDS,
} from "./constants";
export { sessionPda, vaultPda, positionPda, coverPda, sellerPda, sellerTaPda, quotePda } from "./pdas";
export { type AccountKind, accountKind, decodeAccount, parseEvents } from "./decode";
export { recomputePath, score, budgets, claimAmount, coverPayout } from "./math";
export { fmtPp, fmtPpMonths, fmtMillionthsPct, fmtPlay, fmtPeriod } from "./format";
export { toSessionView, toPositionView, toCoverView, toSellerView, toEntryQuoteView } from "./view";
export { fmtPpDifference, fmtPointMonths, fmtQuotePlay } from "./format";
export {
  type AmountSummary,
  type HoldingSummary,
  sumAmounts,
  calculateAccruedScores,
  summarizeHolding,
} from "./presentation";
