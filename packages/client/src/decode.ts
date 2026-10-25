import { BorshAccountsCoder, BorshCoder, EventParser } from "@anchor-lang/core";
import type { PublicKey } from "@solana/web3.js";
import { ACCOUNT_DISCRIMINATORS, IDL, PROGRAM_ID } from "./constants";
import type { EventView } from "./types";

export type AccountKind = "Session" | "Position" | "Cover" | "Seller" | "EntryQuote";

const KINDS = Object.keys(ACCOUNT_DISCRIMINATORS) as AccountKind[];
const accountsCoder = new BorshAccountsCoder(IDL);
const eventParser = new EventParser(PROGRAM_ID, new BorshCoder(IDL));

/** Which account type these bytes are (by discriminator), or null if not one of ours. */
export function accountKind(data: Uint8Array): AccountKind | null {
  if (data.length < 8) return null;
  return KINDS.find((k) => ACCOUNT_DISCRIMINATORS[k].every((b, i) => data[i] === b)) ?? null;
}

/** Anchor-decoded raw account (snake_case fields as in the IDL). Throws on wrong discriminator. */
export function decodeAccount<T = Record<string, unknown>>(kind: AccountKind, data: Uint8Array): T {
  if (accountKind(data) !== kind) throw new Error(`@macropaths/client: bytes are not a ${kind} account`);
  return accountsCoder.decode(kind, Buffer.from(data)) as T;
}

// ---- raw value helpers (shared with view.ts) ----

/** BN / number / bigint -> decimal string. */
export function dec(v: unknown): string {
  if (typeof v === "bigint" || typeof v === "number") return BigInt(v).toString();
  const s = v != null ? (v as { toString(base?: number): string }).toString(10) : "";
  if (!/^-?\d+$/.test(s)) throw new Error("@macropaths/client: not an integer");
  return s;
}
export const big = (v: unknown): bigint => BigInt(dec(v));
export const hex = (v: ArrayLike<number>): string =>
  Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
export const b58 = (v: unknown): string => (v as PublicKey).toBase58();
export const decs = <T extends string[]>(v: unknown[]): T => v.map(dec) as T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
type T2 = [string, string];
type T4 = [string, string, string, string];

function eventData(name: string, d: Raw): EventView["data"] | null {
  switch (name) {
    case "Observed":
      return {
        index: Number(d.index),
        periodId: Number(d.period_id),
        value: dec(d.value),
        peak: dec(d.peak),
        maxDecline: dec(d.max_decline),
        excessAcc: dec(d.excess_acc),
        commitment: hex(d.commitment),
      };
    case "Settled":
      return {
        scores: decs<T2>(d.scores),
        matched: decs<T2>(d.matched),
        pBudget: decs<T4>(d.p_budget),
        rBudget: decs<T4>(d.r_budget),
      };
    case "Claimed":
      return { owner: b58(d.owner), amounts: decs<T2>(d.amounts), refund: Boolean(d.refund) };
    case "CoverBought":
      return {
        owner: b58(d.owner),
        product: Number(d.product),
        units: dec(d.units),
        buyerPaid: dec(d.buyer_paid),
        sellerPaid: dec(d.seller_paid),
      };
    default:
      return null;
  }
}

/**
 * Parse Observed / Settled / Claimed / CoverBought from a transaction's log messages.
 * Each event carries the `session` from its emitted data and `eventIndex`: its position among all
 * parsed MacroPaths events of the transaction, in log order. Callers filter by session afterwards,
 * so indices stay stable regardless of the filter.
 */
export function parseEvents(
  logs: string[],
  meta: { signature: string; slot: number; blockTime: number | null },
): EventView[] {
  const out: EventView[] = [];
  let eventIndex = 0;
  for (const ev of eventParser.parseLogs(logs)) {
    const index = eventIndex++;
    const raw = ev.data as Raw;
    const data = eventData(ev.name, raw);
    if (data) out.push({ type: ev.name, ...meta, session: b58(raw.session), eventIndex: index, data } as EventView);
  }
  return out;
}
