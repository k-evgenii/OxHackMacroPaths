/**
 * Session operations: seed the four sides, lock, settle, expire, claim, sweep, status.
 * Each one reads the on-chain state first and only sends what is still missing, so re-running
 * after a crash or a second invocation is safe.
 */
import path from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { Idl } from "@anchor-lang/core";
import { getConfig, getConnection, loadKeypair } from "./env.js";
import { sendAndConfirmWithRetry } from "./tx.js";
import { loadIdl } from "./session.js";
import {
  big,
  bn,
  enumName,
  fetchDecoded,
  instruction,
  play,
  positionPda,
  readSessionFile,
  requireProgram,
  type SessionFile,
} from "./program.js";

/** Side order everywhere: [product 0 side 0, product 0 side 1, product 1 side 0, product 1 side 1]. */
export const SIDE_NAMES = ["cooling/more", "cooling/less", "excess/more", "excess/less"];

/** Demo seed per side in PLAY: side 0 = 90, side 1 = 100 for each product, so a buyer is fully matched. */
export const DEFAULT_SEED = "90,100,90,100";

export interface Ctx {
  connection: Connection;
  idl: Idl;
  keeper: Keypair;
  file: SessionFile;
  session: PublicKey;
  repoRoot: string;
}

export function loadCtx(opts: { idl?: string; sessionFile?: string }): Ctx {
  const cfg = getConfig();
  const idl = loadIdl(path.resolve(cfg.repoRoot, opts.idl ?? "packages/client/idl.json"));
  const file = readSessionFile(path.resolve(cfg.repoRoot, opts.sessionFile ?? "data/session.json"));
  requireProgram(idl, file);
  return {
    connection: getConnection("confirmed"),
    idl,
    keeper: loadKeypair(),
    file,
    session: new PublicKey(file.session),
    repoRoot: cfg.repoRoot,
  };
}

/** Cluster unix time from the Clock sysvar (unix_timestamp is the i64 at offset 32). */
export async function clusterTime(connection: Connection): Promise<bigint> {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  if (!info || info.data.length < 40) throw new Error("cannot read the Clock sysvar");
  return info.data.readBigInt64LE(32);
}

export async function fetchSession(ctx: Ctx): Promise<Record<string, any>> {
  const s = await fetchDecoded(ctx.connection, ctx.idl, "Session", ctx.session);
  if (!s) throw new Error(`session ${ctx.session.toBase58()} not found`);
  return s;
}

/** Fee payer is the keeper. Later signers (the claim owner) are added once. */
function dedupeSigners(signers: Keypair[]): Keypair[] {
  const seen = new Set<string>();
  const out: Keypair[] = [];
  for (const s of signers) {
    const k = s.publicKey.toBase58();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Fee payer is the keeper. `signers` must include the keeper and any other required signer. */
export async function sendInstructions(
  ctx: Ctx,
  label: string,
  ixs: TransactionInstruction[],
  signers: Keypair[] = [ctx.keeper],
): Promise<string> {
  const res = await sendAndConfirmWithRetry(
    ctx.connection,
    (blockhash) => new Transaction({ feePayer: ctx.keeper.publicKey, recentBlockhash: blockhash }).add(...ixs),
    dedupeSigners(signers),
    { label },
  );
  return res.signature;
}

const send = sendInstructions;

/** Token amount, or 0 when the account has not been created yet. */
export async function tokenAmount(connection: Connection, account: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(account);
  if (!info) return 0n;
  return BigInt((await connection.getTokenAccountBalance(account)).value.amount);
}

/** Parse "90,100,90,100" style per-side PLAY amounts. */
export function parseSides(s: string, parse: (x: string) => bigint): bigint[] {
  const parts = s.split(",").map((x) => parse(x));
  if (parts.length !== 4) throw new Error(`expected 4 comma-separated side amounts, got ${parts.length}`);
  return parts;
}

/**
 * Bring the keeper's position up to `targets` (base units per side), minting any PLAY shortfall to
 * the keeper first (the keeper is the PLAY mint authority). Deposits only the difference from what
 * the position already holds; returns null if nothing was needed.
 */
export async function seedSides(ctx: Ctx, targets: bigint[]): Promise<string | null> {
  const s = await fetchSession(ctx);
  const [position] = positionPda(new PublicKey(ctx.idl.address), ctx.session, ctx.keeper.publicKey);
  const pos = await fetchDecoded(ctx.connection, ctx.idl, "Position", position);
  const have: bigint[] = pos ? (pos.deposited as unknown[]).map(big) : [0n, 0n, 0n, 0n];
  const need = targets.map((t, j) => t - have[j]!);
  const over = need.findIndex((n) => n < 0n);
  if (over >= 0) {
    throw new Error(`side ${over} already holds ${play(have[over]!)} PLAY, more than the target ${play(targets[over]!)}`);
  }
  if (need.every((n) => n === 0n)) {
    console.log(`seed: keeper position already holds ${have.map(play).join(", ")} PLAY`);
    return null;
  }
  if (enumName(s.state) !== "open") throw new Error(`cannot seed: session is ${enumName(s.state)}, not open`);
  const now = await clusterTime(ctx.connection);
  if (now > big(s.deposit_deadline)) throw new Error(`cannot seed: deposit deadline ${s.deposit_deadline} has passed`);

  const mint = new PublicKey(ctx.file.mint);
  const owner = ctx.keeper.publicKey;
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const total = need.reduce((a, b) => a + b, 0n);
  let balance = 0n;
  const ataInfo = await ctx.connection.getAccountInfo(ata);
  if (ataInfo) balance = BigInt((await ctx.connection.getTokenAccountBalance(ata)).value.amount);
  const shortfall = total > balance ? total - balance : 0n;

  const ixs = [createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, mint)];
  if (shortfall > 0n) ixs.push(createMintToInstruction(mint, ata, owner, shortfall));
  ixs.push(
    instruction(ctx.idl, "deposit", { amounts: need.map(bn) }, {
      owner,
      session: ctx.session,
      position,
      owner_ta: ata,
      vault_0: new PublicKey(ctx.file.vaults[0]),
      vault_1: new PublicKey(ctx.file.vaults[1]),
      token_program: TOKEN_PROGRAM_ID,
      system_program: SystemProgram.programId,
    }),
  );
  console.log(`seed: depositing ${need.map(play).join(", ")} PLAY${shortfall > 0n ? ` (minting ${play(shortfall)})` : ""}`);
  return send(ctx, "deposit", ixs);
}

/** lock_and_start once every side has a deposit. Returns null if already past Open. */
export async function lockSession(ctx: Ctx): Promise<string | null> {
  const s = await fetchSession(ctx);
  const state = enumName(s.state);
  if (state !== "open") {
    console.log(`lock: session is already ${state}`);
    return null;
  }
  const totals = (s.side_totals as unknown[]).map(big);
  const empty = totals.findIndex((t) => t === 0n);
  if (empty >= 0) throw new Error(`cannot lock: side ${empty} (${SIDE_NAMES[empty]}) is empty; seed first`);
  return send(ctx, "lock_and_start", [
    instruction(ctx.idl, "lock_and_start", {}, { authority: ctx.keeper.publicKey, session: ctx.session }),
  ]);
}

/** settle once all observations are in and the chain reached C_N. Returns null if already settled. */
export async function settleSession(ctx: Ctx): Promise<string | null> {
  const s = await fetchSession(ctx);
  const state = enumName(s.state);
  if (state === "settled") {
    console.log("settle: session is already settled");
    return null;
  }
  if (state !== "running") throw new Error(`cannot settle: session is ${state}, not running`);
  if (s.next_index !== s.n_obs || !Buffer.from(s.commitment).equals(Buffer.from(s.terminal))) {
    throw new Error(`cannot settle: replay incomplete (${s.next_index} of ${s.n_obs} observations)`);
  }
  return send(ctx, "settle", [instruction(ctx.idl, "settle", {}, { session: ctx.session })]);
}

/**
 * expire_incomplete. Already Refunding means the step is done, so this sends nothing.
 * Open past the deposit deadline, or Running past the replay deadline with rows left, sends.
 */
export async function expireSession(ctx: Ctx): Promise<string | null> {
  const s = await fetchSession(ctx);
  const state = enumName(s.state);
  if (state === "refunding") {
    console.log("expire: session is already refunding");
    return null;
  }
  const now = await clusterTime(ctx.connection);
  const depositLapsed = state === "open" && now > big(s.deposit_deadline);
  const replayLapsed = state === "running" && now > big(s.replay_deadline) && Number(s.next_index) < Number(s.n_obs);
  if (!depositLapsed && !replayLapsed) {
    throw new Error(
      `cannot expire: session is ${state}, observations ${s.next_index} of ${s.n_obs}, deposit deadline ${s.deposit_deadline}, replay deadline ${s.replay_deadline}`,
    );
  }
  return send(ctx, "expire_incomplete", [
    instruction(ctx.idl, "expire_incomplete", {}, { session: ctx.session }),
  ]);
}

/**
 * claim for `owner`'s position. Already claimed means the step is done, so this sends nothing.
 * Prints the owner's PLAY balance before and after. Creates the PLAY token account when it is missing.
 * The keeper pays the fee; `owner` signs the claim.
 */
export async function claimPosition(ctx: Ctx, owner: Keypair): Promise<string | null> {
  const s = await fetchSession(ctx);
  const state = enumName(s.state);
  if (state !== "settled" && state !== "refunding") {
    throw new Error(`cannot claim: session is ${state}`);
  }
  const [position] = positionPda(new PublicKey(ctx.idl.address), ctx.session, owner.publicKey);
  const pos = await fetchDecoded(ctx.connection, ctx.idl, "Position", position);
  if (!pos) throw new Error(`no position for ${owner.publicKey.toBase58()}`);

  const mint = new PublicKey(ctx.file.mint);
  const ata = getAssociatedTokenAddressSync(mint, owner.publicKey);
  const before = await tokenAmount(ctx.connection, ata);
  console.log(`claim: PLAY before ${play(before)}`);
  if (pos.claimed) {
    console.log("claim: position already claimed");
    console.log(`claim: PLAY after ${play(before)}`);
    return null;
  }

  const sig = await send(
    ctx,
    "claim",
    [
      createAssociatedTokenAccountIdempotentInstruction(ctx.keeper.publicKey, ata, owner.publicKey, mint),
      instruction(ctx.idl, "claim", {}, {
        owner: owner.publicKey,
        session: ctx.session,
        position,
        owner_ta: ata,
        vault_0: new PublicKey(ctx.file.vaults[0]),
        vault_1: new PublicKey(ctx.file.vaults[1]),
        token_program: TOKEN_PROGRAM_ID,
      }),
    ],
    [ctx.keeper, owner],
  );
  const after = await tokenAmount(ctx.connection, ata);
  console.log(`claim: PLAY after ${play(after)}`);
  return sig;
}

/**
 * sweep_dust into `treasury`'s PLAY account, creating that account when it is missing.
 * Both vaults already at 0 means the dust is gone, so this sends nothing.
 */
export async function sweepDust(ctx: Ctx, treasury: PublicKey): Promise<string | null> {
  const s = await fetchSession(ctx);
  const state = enumName(s.state);
  if (state !== "settled" && state !== "refunding") {
    throw new Error(`cannot sweep: session is ${state}`);
  }
  const claimed = Number(big(s.claimed_count));
  const positions = Number(big(s.position_count));
  const coverClaimed = Number(big(s.cover_claimed_count));
  const covers = Number(big(s.cover_count));
  const sellerOpen = Number(big(s.seller_products_open));
  if (claimed !== positions || coverClaimed !== covers || sellerOpen !== 0) {
    throw new Error(
      `cannot sweep: claimed_count/position_count ${claimed}/${positions}, cover_claimed_count/cover_count ${coverClaimed}/${covers}, seller_products_open ${sellerOpen}`,
    );
  }
  const [v0, v1] = await vaultBalances(ctx);
  if (v0 === 0n && v1 === 0n) {
    console.log("sweep: vaults are already empty");
    return null;
  }
  const mint = new PublicKey(ctx.file.mint);
  // Any pubkey can be the treasury, including one that is not an ed25519 point.
  const treasuryTa = getAssociatedTokenAddressSync(mint, treasury, true);
  console.log(`sweep: ${play(v0)} and ${play(v1)} PLAY to ${treasury.toBase58()}`);
  return send(ctx, "sweep_dust", [
    createAssociatedTokenAccountIdempotentInstruction(ctx.keeper.publicKey, treasuryTa, treasury, mint),
    instruction(ctx.idl, "sweep_dust", {}, {
      authority: ctx.keeper.publicKey,
      session: ctx.session,
      treasury_ta: treasuryTa,
      vault_0: new PublicKey(ctx.file.vaults[0]),
      vault_1: new PublicKey(ctx.file.vaults[1]),
      token_program: TOKEN_PROGRAM_ID,
    }),
  ]);
}

/** Human-readable session summary. */
export function describeSession(s: Record<string, any>): string[] {
  const list = (v: unknown[], f: (x: bigint) => string) => v.map((x) => f(big(x))).join(", ");
  const scores = (s.scores as unknown[]).map((x) => (Number(big(x)) / 1e6).toFixed(6));
  return [
    `state        ${enumName(s.state)}`,
    `observations ${s.next_index} of ${s.n_obs}`,
    `side totals  ${list(s.side_totals, play)} PLAY  (${SIDE_NAMES.join(", ")})`,
    `matched      ${list(s.matched, play)} PLAY`,
    `scores       ${scores.join(", ")}  (cooling, excess)`,
    `payout P_j   ${list(s.p_budget, play)} PLAY`,
    `refund R_j   ${list(s.r_budget, play)} PLAY`,
    `positions    ${s.position_count} (${s.claimed_count} claimed)`,
    `p_budget     ${list(s.p_budget, play)} PLAY`,
    `r_budget     ${list(s.r_budget, play)} PLAY`,
    `claimed_count/position_count ${s.claimed_count}/${s.position_count}`,
  ];
}

/** `vaults       0, 0 PLAY` */
export function vaultLine(v0: bigint, v1: bigint): string {
  return `vaults       ${play(v0)}, ${play(v1)} PLAY`;
}

export async function vaultBalances(ctx: Ctx): Promise<[bigint, bigint]> {
  return [
    await tokenAmount(ctx.connection, new PublicKey(ctx.file.vaults[0])),
    await tokenAmount(ctx.connection, new PublicKey(ctx.file.vaults[1])),
  ];
}

/** describeSession plus the two vault balances in PLAY. */
export async function statusLines(ctx: Ctx): Promise<string[]> {
  const [s, balances] = await Promise.all([fetchSession(ctx), vaultBalances(ctx)]);
  return [...describeSession(s), vaultLine(balances[0], balances[1])];
}
