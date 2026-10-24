/**
 * Seller extension callers: fund, quote, buy, settle, withdraw.
 * Each one reads the on-chain accounts first and sends nothing when that step is already done.
 * The keeper is the session authority and the seller wallet. A buyer's keypair is separate.
 */
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  clusterTime,
  fetchSession,
  sendInstructions,
  tokenAmount,
  type Ctx,
} from "./ops.js";
import { big, bn, enumName, fetchDecoded, instruction, play } from "./program.js";

/** Quote bounds from the program: 0.05 and 0.95, in millionths. */
export const QUOTE_MIN = 50_000n;
export const QUOTE_MAX = 950_000n;

const SEED_SELLER = Buffer.from("seller");
const SEED_SELLER_TA = Buffer.from("seller_ta");
const SEED_QUOTE = Buffer.from("quote");
const SEED_COVER = Buffer.from("cover");

function pda(programId: PublicKey, seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export function sellerAddress(programId: PublicKey, session: PublicKey): PublicKey {
  return pda(programId, [SEED_SELLER, session.toBuffer()]);
}

export function sellerTaAddress(programId: PublicKey, session: PublicKey): PublicKey {
  return pda(programId, [SEED_SELLER_TA, session.toBuffer()]);
}

export function quoteAddress(programId: PublicKey, session: PublicKey): PublicKey {
  return pda(programId, [SEED_QUOTE, session.toBuffer()]);
}

export function coverAddress(programId: PublicKey, session: PublicKey, buyer: PublicKey): PublicKey {
  return pda(programId, [SEED_COVER, session.toBuffer(), buyer.toBuffer()]);
}

/** "0.40" or "0.4" -> millionths. Digits past the 6th decimal are dropped (floor). */
export function decimalToMillionths(raw: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!m) throw new Error(`not a probability: ${raw}`);
  const whole = BigInt(m[1]!) * 1_000_000n;
  const frac = BigInt((m[2] ?? "").slice(0, 6).padEnd(6, "0") || "0");
  return whole + frac;
}

function toMillionths(v: unknown, what: string): bigint {
  if (typeof v === "string") return decimalToMillionths(v);
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    const text = JSON.stringify(v);
    if (!/^(\d+)(?:\.(\d+))?$/.test(text)) throw new Error(`${what} ${text} is not a plain decimal`);
    return decimalToMillionths(text);
  }
  throw new Error(`${what} must be a decimal probability`);
}

/** `clamp(V + floor(σ / 2), 0.05, 0.95)` in millionths. */
export function clampQuote(vMillionths: bigint, sigmaMillionths: bigint): bigint {
  const p = vMillionths + sigmaMillionths / 2n;
  if (p < QUOTE_MIN) return QUOTE_MIN;
  if (p > QUOTE_MAX) return QUOTE_MAX;
  return p;
}

/**
 * Row 0 of a forecast table. `V` and `sigma` are probabilities; the same clamped price is used
 * for both products. Accepts a bare array or `{ rows: [...] }`.
 */
export function pricesFromForecast(json: unknown): [bigint, bigint] {
  const rows = Array.isArray(json) ? json : (json as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("forecast table has no row 0");
  const row = rows[0] as Record<string, unknown>;
  if (!row || typeof row !== "object") throw new Error("forecast row 0 is not an object");
  const v = row.V ?? row.v;
  const sigma = row.sigma ?? row["σ"];
  if (v === undefined || sigma === undefined) throw new Error("forecast row 0 needs V and sigma");
  const p = clampQuote(toMillionths(v, "V"), toMillionths(sigma, "sigma"));
  return [p, p];
}

export function loadForecastPrices(file: string): [bigint, bigint] {
  return pricesFromForecast(JSON.parse(readFileSync(file, "utf8")));
}

function programId(ctx: Ctx): PublicKey {
  return new PublicKey(ctx.idl.address);
}

function sameKey(v: unknown, k: PublicKey): boolean {
  if (v instanceof PublicKey) return v.equals(k);
  return typeof v === "string" && v === k.toBase58();
}

function requireQuote(p: bigint, which: string): void {
  if (p < QUOTE_MIN || p > QUOTE_MAX) {
    throw new Error(`${which} ${p} is outside ${QUOTE_MIN}..${QUOTE_MAX}`);
  }
}

async function requireOpen(ctx: Ctx, what: string): Promise<Record<string, any>> {
  const s = await fetchSession(ctx);
  const state = enumName(s.state);
  if (state !== "open") throw new Error(`cannot ${what}: session is ${state}`);
  const now = await clusterTime(ctx.connection);
  if (now > big(s.deposit_deadline)) {
    throw new Error(`cannot ${what}: deposit deadline ${s.deposit_deadline} has passed`);
  }
  return s;
}

/** Mint `need` base units to `owner` when the keeper is the mint authority. Returns the ATA. */
async function playFor(ctx: Ctx, owner: PublicKey, need: bigint): Promise<{ ata: PublicKey; ixs: TransactionInstruction[] }> {
  const mint = new PublicKey(ctx.file.mint);
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const have = await tokenAmount(ctx.connection, ata);
  const short = need > have ? need - have : 0n;
  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(ctx.keeper.publicKey, ata, owner, mint),
  ];
  if (short > 0n) {
    const info = await getMint(ctx.connection, mint);
    if (!info.mintAuthority?.equals(ctx.keeper.publicKey)) {
      throw new Error(`short ${play(short)} PLAY and the keeper is not the mint authority`);
    }
    ixs.push(createMintToInstruction(mint, ata, ctx.keeper.publicKey, short));
  }
  return { ata, ixs };
}

/**
 * Bring the keeper-seller's free_cash up to `amount` (base units). Sends nothing when it is already there.
 */
export async function fundSeller(ctx: Ctx, amount: bigint): Promise<string | null> {
  if (amount <= 0n) throw new Error("fund amount must be positive");
  const program = programId(ctx);
  const seller = sellerAddress(program, ctx.session);
  const existing = await fetchDecoded(ctx.connection, ctx.idl, "Seller", seller);
  if (existing && !sameKey(existing.seller, ctx.keeper.publicKey) && !sameKey(existing.seller, PublicKey.default)) {
    throw new Error(`seller is ${existing.seller.toString()}, not the keeper`);
  }
  const have = existing ? big(existing.free_cash) : 0n;
  if (have >= amount) {
    console.log(`fund: seller already holds ${play(have)} PLAY`);
    return null;
  }
  await requireOpen(ctx, "fund");
  const need = amount - have;
  const { ata, ixs } = await playFor(ctx, ctx.keeper.publicKey, need);
  ixs.push(
    instruction(ctx.idl, "seller_fund", { amount: bn(need) }, {
      seller_wallet: ctx.keeper.publicKey,
      session: ctx.session,
      seller,
      seller_ta: sellerTaAddress(program, ctx.session),
      seller_wallet_ta: ata,
      play_mint: new PublicKey(ctx.file.mint),
      token_program: TOKEN_PROGRAM_ID,
      system_program: SystemProgram.programId,
    }),
  );
  console.log(`fund: ${play(need)} PLAY`);
  return sendInstructions(ctx, "seller_fund", ixs);
}

/** set_entry_quote. Sends nothing when the quote is already these two prices. */
export async function quoteSeller(ctx: Ctx, p0: bigint, p1: bigint): Promise<string | null> {
  requireQuote(p0, "p0");
  requireQuote(p1, "p1");
  const program = programId(ctx);
  const quote = quoteAddress(program, ctx.session);
  const existing = await fetchDecoded(ctx.connection, ctx.idl, "EntryQuote", quote);
  if (existing?.is_set && big((existing.p as unknown[])[0]) === p0 && big((existing.p as unknown[])[1]) === p1) {
    console.log(`quote: already ${p0} ${p1}`);
    return null;
  }
  if (existing?.frozen) throw new Error("cannot quote: the quote is frozen");
  await requireOpen(ctx, "quote");
  console.log(`quote: ${p0} ${p1}`);
  return sendInstructions(ctx, "set_entry_quote", [
    instruction(ctx.idl, "set_entry_quote", { p: [bn(p0), bn(p1)] }, {
      authority: ctx.keeper.publicKey,
      session: ctx.session,
      quote,
      system_program: SystemProgram.programId,
    }),
  ]);
}

/** buy_cover. Creates the buyer's PLAY account when it is missing and mints a shortfall from the keeper. */
export async function buyCover(ctx: Ctx, product: 0 | 1, units: bigint, buyer: Keypair): Promise<string | null> {
  if (units <= 0n) throw new Error("units must be positive");
  await requireOpen(ctx, "buy");
  const program = programId(ctx);
  const quote = quoteAddress(program, ctx.session);
  const seller = sellerAddress(program, ctx.session);
  const q = await fetchDecoded(ctx.connection, ctx.idl, "EntryQuote", quote);
  if (!q?.is_set) throw new Error("cannot buy: quote is not set");
  if (!(await fetchDecoded(ctx.connection, ctx.idl, "Seller", seller))) throw new Error("cannot buy: seller is not funded");
  const { ata, ixs } = await playFor(ctx, buyer.publicKey, units);
  ixs.push(
    instruction(ctx.idl, "buy_cover", { product, units: bn(units) }, {
      buyer: buyer.publicKey,
      session: ctx.session,
      quote,
      seller,
      seller_ta: sellerTaAddress(program, ctx.session),
      cover: coverAddress(program, ctx.session, buyer.publicKey),
      buyer_ta: ata,
      vault: new PublicKey(ctx.file.vaults[product]),
      token_program: TOKEN_PROGRAM_ID,
      system_program: SystemProgram.programId,
    }),
  );
  console.log(`buy: product ${product} ${play(units)} PLAY`);
  return sendInstructions(ctx, "buy_cover", ixs, [ctx.keeper, buyer]);
}

/** seller_settle. Sends nothing when that product is already settled. */
export async function settleSeller(ctx: Ctx, product: 0 | 1): Promise<string | null> {
  const s = await fetchSession(ctx);
  const state = enumName(s.state);
  const program = programId(ctx);
  const seller = sellerAddress(program, ctx.session);
  const existing = await fetchDecoded(ctx.connection, ctx.idl, "Seller", seller);
  if (!existing) throw new Error("cannot seller-settle: seller is not funded");
  if ((existing.settled as unknown[])[product] === true) {
    console.log(`seller settle: product ${product} already settled`);
    return null;
  }
  if (state !== "settled" && state !== "refunding") {
    throw new Error(`cannot seller-settle: session is ${state}`);
  }
  console.log(`seller settle: product ${product}`);
  return sendInstructions(ctx, "seller_settle", [
    instruction(ctx.idl, "seller_settle", { product }, {
      session: ctx.session,
      seller,
      seller_ta: sellerTaAddress(program, ctx.session),
      vault: new PublicKey(ctx.file.vaults[product]),
      token_program: TOKEN_PROGRAM_ID,
    }),
  ]);
}

/** seller_withdraw of `amount` base units. Sends nothing when free_cash is already 0. */
export async function withdrawSeller(ctx: Ctx, amount: bigint): Promise<string | null> {
  if (amount <= 0n) throw new Error("withdraw amount must be positive");
  const program = programId(ctx);
  const seller = sellerAddress(program, ctx.session);
  const existing = await fetchDecoded(ctx.connection, ctx.idl, "Seller", seller);
  if (!existing) throw new Error("cannot withdraw: seller is not funded");
  if (!sameKey(existing.seller, ctx.keeper.publicKey)) {
    throw new Error(`seller is ${existing.seller.toString()}, not the keeper`);
  }
  const escrow = (existing.escrow as unknown[]).map(big);
  if (escrow[0] !== 0n || escrow[1] !== 0n) throw new Error("cannot withdraw: seller escrow is still outstanding");
  const cash = big(existing.free_cash);
  if (cash === 0n) {
    console.log("withdraw: seller free_cash is 0");
    return null;
  }
  if (amount > cash) throw new Error(`cannot withdraw ${play(amount)} PLAY; free_cash is ${play(cash)}`);
  const { ata, ixs } = await playFor(ctx, ctx.keeper.publicKey, 0n);
  ixs.push(
    instruction(ctx.idl, "seller_withdraw", { amount: bn(amount) }, {
      seller_wallet: ctx.keeper.publicKey,
      session: ctx.session,
      seller,
      seller_ta: sellerTaAddress(program, ctx.session),
      seller_wallet_ta: ata,
      token_program: TOKEN_PROGRAM_ID,
    }),
  );
  console.log(`withdraw: ${play(amount)} PLAY`);
  return sendInstructions(ctx, "seller_withdraw", ixs);
}
