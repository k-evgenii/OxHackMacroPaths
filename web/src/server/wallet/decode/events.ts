// Program events relevant to wallet attribution, keeping the session field the
// shared EventView v1 omits. Used for reconciliation/refund evidence only.
import { BorshCoder, EventParser } from "@anchor-lang/core";
import { IDL, PROGRAM_ID } from "@macropaths/client";

const parser = new EventParser(PROGRAM_ID, new BorshCoder(IDL));

export type ClaimedEvent = { type: "Claimed"; session: string; owner: string; amounts: [bigint, bigint]; refund: boolean };
export type CoverBoughtEvent = {
  type: "CoverBought";
  session: string;
  owner: string;
  product: number;
  units: bigint;
  buyerPaid: bigint;
  sellerPaid: bigint;
};
export type WalletEvent = ClaimedEvent | CoverBoughtEvent;

const key = (v: unknown) => (v as { toBase58(): string }).toBase58();
const big = (v: unknown) => BigInt((v as { toString(r: number): string }).toString(10));

/** Never throws: undecodable logs simply yield no evidence. */
export function parseWalletEvents(logs: string[]): WalletEvent[] {
  const out: WalletEvent[] = [];
  try {
    for (const ev of parser.parseLogs(logs)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = ev.data as Record<string, any>;
      if (ev.name === "Claimed") {
        out.push({
          type: "Claimed",
          session: key(d.session),
          owner: key(d.owner),
          amounts: [big(d.amounts[0]), big(d.amounts[1])],
          refund: Boolean(d.refund),
        });
      } else if (ev.name === "CoverBought") {
        out.push({
          type: "CoverBought",
          session: key(d.session),
          owner: key(d.owner),
          product: Number(d.product),
          units: big(d.units),
          buyerPaid: big(d.buyer_paid),
          sellerPaid: big(d.seller_paid),
        });
      }
    }
  } catch {
    return out;
  }
  return out;
}
