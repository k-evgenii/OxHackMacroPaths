// Public surface of @macropaths/client. Signatures are FROZEN (integrator-owned);
// agent 1 replaces the bodies by moving each into its module and re-exporting it here.
import type { Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import idlJson from "../idl.json";
import type {
  CoverView,
  EventView,
  EntryQuoteView,
  PathRow,
  PositionView,
  SellerView,
  SessionView,
} from "./types";

export * from "./types";

const todo = (name: string): never => {
  throw new Error(`@macropaths/client: ${name} not implemented`);
};

// ---- constants.ts ---- (values final; agent 1 may move them into constants.ts)
export const IDL = idlJson as unknown as Idl;
export const PROGRAM_ID = new PublicKey(idlJson.address);
export const N_OBS = 48 as const;
export const ONE = 1_000_000n;
export const PLAY_DECIMALS = 6 as const;
export const PRODUCT_NAMES = ["Inflation Cooling", "Excess Inflation"] as const;
export const SIDE_NAMES = ["cooling/more", "cooling/less", "excess/more", "excess/less"] as const;
/** 8-byte account discriminators, for getProgramAccounts memcmp filters. */
export const ACCOUNT_DISCRIMINATORS = Object.fromEntries(
  idlJson.accounts.map((a) => [a.name, Uint8Array.from(a.discriminator)]),
) as Record<"Session" | "Position" | "Cover" | "Seller" | "EntryQuote", Uint8Array>;
/** Byte offset of the `session` pubkey in Position, Cover, Seller and EntryQuote (after the discriminator). */
export const SESSION_FIELD_OFFSET = 8 as const;

// ---- pdas.ts ---- (each returns [address, bump])
export function sessionPda(authority: PublicKey, sessionId: bigint): [PublicKey, number] { return todo("sessionPda"); }
export function vaultPda(session: PublicKey, product: 0 | 1): [PublicKey, number] { return todo("vaultPda"); }
export function positionPda(session: PublicKey, owner: PublicKey): [PublicKey, number] { return todo("positionPda"); }
export function coverPda(session: PublicKey, owner: PublicKey): [PublicKey, number] { return todo("coverPda"); }
export function sellerPda(session: PublicKey): [PublicKey, number] { return todo("sellerPda"); }
export function sellerTaPda(session: PublicKey): [PublicKey, number] { return todo("sellerTaPda"); }
export function quotePda(session: PublicKey): [PublicKey, number] { return todo("quotePda"); }

// ---- decode.ts ----
export type AccountKind = "Session" | "Position" | "Cover" | "Seller" | "EntryQuote";
/** Which account type these bytes are (by discriminator), or null if not one of ours. */
export function accountKind(data: Uint8Array): AccountKind | null { return todo("accountKind"); }
/** Anchor-decoded raw account (snake_case fields as in the IDL). Throws on wrong discriminator. */
export function decodeAccount<T = Record<string, unknown>>(kind: AccountKind, data: Uint8Array): T { return todo("decodeAccount"); }
/** Parse Observed / Settled / Claimed / CoverBought from a transaction's log messages. */
export function parseEvents(
  logs: string[],
  meta: { signature: string; slot: number; blockTime: number | null },
): EventView[] { return todo("parseEvents"); }

// ---- math.ts ---- (bigint-exact ports of programs/macropaths/src/math.rs)
export function recomputePath(values: bigint[], k: bigint, lastPeriodId: number): PathRow[] { return todo("recomputePath"); }
export function score(stat: bigint, cap: bigint): bigint { return todo("score"); }
export function budgets(sideTotals: bigint[], scores: bigint[]): { matched: bigint[]; p: bigint[]; r: bigint[] } { return todo("budgets"); }
export function claimAmount(deposited: bigint, r: bigint, p: bigint, sideTotal: bigint): bigint { return todo("claimAmount"); }
export function coverPayout(scoreMillionths: bigint, units: bigint): bigint { return todo("coverPayout"); }

// ---- format.ts ---- (display only; never feed results back into math)
export function fmtPp(v: string | bigint, digits?: number): string { return todo("fmtPp"); }
export function fmtPpMonths(v: string | bigint, digits?: number): string { return todo("fmtPpMonths"); }
export function fmtMillionthsPct(v: string | bigint, digits?: number): string { return todo("fmtMillionthsPct"); }
export function fmtPlay(v: string | bigint, digits?: number): string { return todo("fmtPlay"); }
export function fmtPeriod(periodId: number): string { return todo("fmtPeriod"); }

// ---- view.ts ----
export function toSessionView(address: string, data: Uint8Array): SessionView { return todo("toSessionView"); }
export function toPositionView(address: string, data: Uint8Array, session: SessionView): PositionView { return todo("toPositionView"); }
export function toCoverView(address: string, data: Uint8Array, session: SessionView): CoverView { return todo("toCoverView"); }
export function toSellerView(address: string, data: Uint8Array): SellerView { return todo("toSellerView"); }
export function toEntryQuoteView(address: string, data: Uint8Array): EntryQuoteView { return todo("toEntryQuoteView"); }
