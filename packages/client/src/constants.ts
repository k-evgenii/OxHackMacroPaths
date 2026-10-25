import type { Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import idlJson from "../idl.json";

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

const utf8 = (s: string) => new TextEncoder().encode(s);
/** PDA seed prefixes, as in programs/macropaths/src/constants.rs. */
export const SEEDS = {
  session: utf8("session"),
  vault: utf8("vault"),
  position: utf8("position"),
  seller: utf8("seller"),
  sellerTa: utf8("seller_ta"),
  quote: utf8("quote"),
  cover: utf8("cover"),
} as const;
