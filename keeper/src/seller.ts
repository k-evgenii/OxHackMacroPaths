/**
 * Seller extension callers: fund, quote, buy, claim-cover, settle, withdraw.
 * Each one reads the on-chain accounts first and sends nothing when that step is already done.
 * The keeper is the session authority and the seller wallet. A buyer's keypair is separate.
 */
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import type { Idl } from "@anchor-lang/core";
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

function toScaled(v: unknown, what: string, digits: number): bigint {
  const text = typeof v === "number" && Number.isFinite(v) && v >= 0 ? JSON.stringify(v) : v;
  if (typeof text !== "string") throw new Error(`${what} must be a decimal probability`);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new Error(`${what} ${text} is not a plain decimal`);
  return BigInt(m[1]!) * 10n ** BigInt(digits) + BigInt((m[2] ?? "").slice(0, digits).padEnd(digits, "0") || "0");
}

/** `clamp(V + floor(σ / 2), 0.05, 0.95)` in millionths. */
export function clampQuote(vMillionths: bigint, sigmaMillionths: bigint): bigint {
  const p = vMillionths + sigmaMillionths / 2n;
  if (p < QUOTE_MIN) return QUOTE_MIN;
  if (p > QUOTE_MAX) return QUOTE_MAX;
  return p;
}

/**
 * Entry prices from a forecast table, in millionths, as [cooling, excess].
 * - `forecast/table.json`: its declared `quotes.p` when present (the policy's own output), otherwise
 *   `clamp(V + sigma/2)` from row 0's `cooling` and `excess` cells.
 * - A flat row 0 with `V` and `sigma` (bare array or `{ rows: [...] }`) gives the same price to both products.
 */
export function pricesFromForecast(json: unknown): [bigint, bigint] {
  const quotes = (json as { quotes?: { p?: unknown } } | null)?.quotes?.p;
  if (Array.isArray(quotes)) {
    if (quotes.length !== 2 || !quotes.every((x) => Number.isInteger(x))) throw new Error("forecast quotes.p must be two integers");
    const [p0, p1] = quotes.map((x) => BigInt(x as number)) as [bigint, bigint];
    requireQuote(p0, "quotes.p[0]");
    requireQuote(p1, "quotes.p[1]");
    return [p0, p1];
  }
  const rows = Array.isArray(json) ? json : (json as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("forecast table has no row 0");
  const row = rows[0] as Record<string, unknown>;
  if (!row || typeof row !== "object") throw new Error("forecast row 0 is not an object");
  const cell = (c: unknown, what: string): bigint => {
    const r = c as Record<string, unknown> | null;
    const v = r?.V ?? r?.v;
    const sigma = r?.sigma ?? r?.["σ"];
    if (v === undefined || sigma === undefined) throw new Error(`forecast ${what} needs V and sigma`);
    return quoteFrom(v, sigma);
  };
  if (row.cooling !== undefined || row.excess !== undefined) return [cell(row.cooling, "row 0 cooling"), cell(row.excess, "row 0 excess")];
  const p = cell(row, "row 0");
  return [p, p];
}

/** `clamp(floor((V + sigma/2)·10^6))`, rounding once on the exact decimals (not after truncating each). */
function quoteFrom(v: unknown, sigma: unknown): bigint {
  const scale = 12;
  const p = (toScaled(v, "V", scale) * 2n + toScaled(sigma, "sigma", scale)) / (2n * 10n ** BigInt(scale - 6));
  return p < QUOTE_MIN ? QUOTE_MIN : p > QUOTE_MAX ? QUOTE_MAX : p;
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

/**
 * buy_cover up to `units` for `product` in `buyer`'s cover. Sends nothing when the cover already holds that
 * many (the program adds units on every call, so a rerun would otherwise buy twice). Mints the buyer only the
 * premium shortfall, `ceil(p·delta / ONE)`, and creates the buyer's PLAY account when it is missing.
 */
export async function buyCover(ctx: Ctx, product: 0 | 1, units: bigint, buyer: Keypair): Promise<string | null> {
  if (units <= 0n) throw new Error("units must be positive");
  const program = programId(ctx);
  const quote = quoteAddress(program, ctx.session);
  const seller = sellerAddress(program, ctx.session);
  const cover = coverAddress(program, ctx.session, buyer.publicKey);
  const existing = await fetchDecoded(ctx.connection, ctx.idl, "Cover", cover);
  const held = existing ? big((existing.units as unknown[])[product]) : 0n;
  if (held >= units) {
    console.log(`buy: cover already holds ${play(held)} PLAY of product ${product}`);
    return null;
  }
  const delta = units - held;
  await requireOpen(ctx, "buy");
  const q = await fetchDecoded(ctx.connection, ctx.idl, "EntryQuote", quote);
  if (!q?.is_set) throw new Error("cannot buy: quote is not set");
  const s = await fetchDecoded(ctx.connection, ctx.idl, "Seller", seller);
  if (!s) throw new Error("cannot buy: seller is not funded");
  const p = big((q.p as unknown[])[product]);
  const premium = (p * delta + 999_999n) / 1_000_000n;
  const sellerPays = delta - premium;
  const cash = big(s.free_cash);
  if (sellerPays > cash) throw new Error(`cannot buy: seller needs ${play(sellerPays)} PLAY free_cash, has ${play(cash)}`);
  const { ata, ixs } = await playFor(ctx, buyer.publicKey, premium);
  ixs.push(
    instruction(ctx.idl, "buy_cover", { product, units: bn(delta) }, {
      buyer: buyer.publicKey,
      session: ctx.session,
      quote,
      seller,
      seller_ta: sellerTaAddress(program, ctx.session),
      cover,
      buyer_ta: ata,
      vault: new PublicKey(ctx.file.vaults[product]),
      token_program: TOKEN_PROGRAM_ID,
      system_program: SystemProgram.programId,
    }),
  );
  console.log(`buy: product ${product} ${play(delta)} PLAY (premium ${play(premium)})${held ? `, cover held ${play(held)}` : ""}`);
  return sendInstructions(ctx, "buy_cover", ixs, [ctx.keeper, buyer]);
}

/** claim_cover for `owner`'s cover PDA `["cover", session, owner]`, accounts in IDL order. */
export function claimCoverIx(
  idl: Idl,
  session: PublicKey,
  owner: PublicKey,
  ownerTa: PublicKey,
  vaults: [PublicKey, PublicKey],
): TransactionInstruction {
  return instruction(idl, "claim_cover", {}, {
    owner,
    session,
    cover: coverAddress(new PublicKey(idl.address), session, owner),
    owner_ta: ownerTa,
    vault_0: vaults[0],
    vault_1: vaults[1],
    token_program: TOKEN_PROGRAM_ID,
  });
}

/**
 * claim_cover for `owner`'s cover. Already claimed means the step is done, so this sends nothing.
 * Prints the owner's PLAY balance before and after (the payout) and cover_claimed_count/cover_count,
 * which sweep needs equal. Creates the owner's PLAY account when it is missing. The keeper pays the
 * fee; `owner` signs.
 */
export async function claimCover(ctx: Ctx, owner: Keypair): Promise<string | null> {
  const s = await fetchSession(ctx);
  const state = enumName(s.state);
  if (state !== "settled" && state !== "refunding") {
    throw new Error(`cannot claim cover: session is ${state}`);
  }
  const cover = coverAddress(programId(ctx), ctx.session, owner.publicKey);
  const c = await fetchDecoded(ctx.connection, ctx.idl, "Cover", cover);
  if (!c) throw new Error(`no cover for ${owner.publicKey.toBase58()}`);
  const counters = (x: Record<string, any>) => `cover_claimed_count/cover_count ${x.cover_claimed_count}/${x.cover_count}`;

  const mint = new PublicKey(ctx.file.mint);
  const ata = getAssociatedTokenAddressSync(mint, owner.publicKey);
  const before = await tokenAmount(ctx.connection, ata);
  console.log(`claim cover: PLAY before ${play(before)}`);
  if (c.claimed) {
    console.log("claim cover: cover already claimed");
    console.log(`claim cover: PLAY after ${play(before)}`);
    console.log(`claim cover: ${counters(s)}`);
    return null;
  }
  const units = (c.units as unknown[]).map(big);
  console.log(`claim cover: units ${units.map(play).join(", ")} PLAY, session ${state}`);
  const sig = await sendInstructions(
    ctx,
    "claim_cover",
    [
      createAssociatedTokenAccountIdempotentInstruction(ctx.keeper.publicKey, ata, owner.publicKey, mint),
      claimCoverIx(ctx.idl, ctx.session, owner.publicKey, ata, [
        new PublicKey(ctx.file.vaults[0]),
        new PublicKey(ctx.file.vaults[1]),
      ]),
    ],
    [ctx.keeper, owner],
  );
  const after = await tokenAmount(ctx.connection, ata);
  console.log(`claim cover: PLAY after ${play(after)}`);
  console.log(`claim cover: payout ${play(after - before)} PLAY`);
  console.log(`claim cover: ${counters(await fetchSession(ctx))}`);
  return sig;
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
