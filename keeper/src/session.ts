/**
 * create_session inputs, instruction and read-back, shared by run.ts (and later replay.ts).
 *
 * Two create_session layouts exist and neither is on `main` yet (see docs/DECISIONS.md):
 *   - "params" (Dev, PR #7 `dev/state-idl`): create_session(nonce, SessionParams { controller,
 *     deadlines, term_sheet_hash, dataset_id, source_digest, series_code, start_period,
 *     expected_count, products[2], initial_commitment, terminal_commitment }).
 *   - "flat" (Evgenii, `cursor_main`): create_session(session_id, k, d_cap, a_cap, deposit_deadline,
 *     replay_deadline, dataset_id, c0, terminal).
 * The layout is read from the IDL's create_session args, so the keeper follows whichever IDL is
 * in packages/client/idl.json. Both use the same PDA seeds. Every value comes from
 * data/cpi-yoy-replay.json (written by prepare.ts) or the command line; nothing is hardcoded.
 */
import { readFileSync } from "node:fs";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import anchor, { type Idl } from "@anchor-lang/core";

const { BN, BorshCoder } = anchor;
type BNType = InstanceType<typeof BN>;

export const SESSION_SEED = Buffer.from("session");
export const VAULT_SEED = Buffer.from("vault");
export const PLAY_DECIMALS = 6;

export type Layout = "params" | "flat";

/** The fields of data/cpi-yoy-replay.json that create_session needs. */
export interface Replay {
  datasetId: Buffer;
  c0: Buffer;
  cN: Buffer;
  n: number;
  firstPeriodId: number;
  k: bigint;
  dCap: bigint;
  aCap: bigint;
  seriesId: string;
  sha256OfRaw: Buffer;
}

/** Values that are not part of the dataset: who creates the session, which mint, when it closes. */
export interface SessionInputs {
  /** Session PDA seed: `nonce` in the params layout, `session_id` in the flat layout. */
  id: bigint;
  creator: PublicKey;
  mint: PublicKey;
  /** Signs observe in the params layout. Not stored by the flat layout. */
  controller: PublicKey;
  depositDeadline: bigint;
  replayDeadline: bigint;
}

function hex32(v: unknown, what: string): Buffer {
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) throw new Error(`${what}: expected 32-byte lowercase hex`);
  return Buffer.from(v, "hex");
}

/** Replay integers are JSON numbers below 2^53 and decimal strings above (see its `integers` note). */
function int(v: unknown, what: string): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  throw new Error(`${what}: expected an integer`);
}

export function parseReplay(json: unknown): Replay {
  const j = json as Record<string, any>;
  if (j?.format !== "macropaths-replay-v1") throw new Error("replay: format is not macropaths-replay-v1");
  return {
    datasetId: hex32(j.dataset_id, "dataset_id"),
    c0: hex32(j.C_0, "C_0"),
    cN: hex32(j.C_N, "C_N"),
    n: Number(int(j.N, "N")),
    firstPeriodId: Number(int(j.first_period_id, "first_period_id")),
    k: int(j.K, "K"),
    dCap: int(j.D_cap, "D_cap"),
    aCap: int(j.A_cap, "A_cap"),
    seriesId: String(j.source?.series_id ?? ""),
    sha256OfRaw: hex32(j.source?.sha256_of_raw, "source.sha256_of_raw"),
  };
}

export function loadReplay(file: string): Replay {
  return parseReplay(JSON.parse(readFileSync(file, "utf8")));
}

export function loadIdl(file: string): Idl {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`${file} not found: the program IDL must be on this checkout (packages/client/idl.json)`);
  }
  const idl = JSON.parse(raw) as Idl;
  if (!idl.address) throw new Error(`${file}: IDL has no address`);
  return idl;
}

function createSessionIdl(idl: Idl) {
  const ix = idl.instructions.find((i) => i.name === "create_session");
  if (!ix) throw new Error("IDL has no create_session instruction");
  return ix;
}

export function detectLayout(idl: Idl): Layout {
  const names = createSessionIdl(idl).args.map((a) => a.name);
  if (names.length === 2 && names[0] === "nonce" && names[1] === "params") return "params";
  if (names[0] === "session_id" && names.includes("dataset_id")) return "flat";
  throw new Error(`unknown create_session layout, args: ${names.join(", ")}`);
}

const u64le = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};

/** ["session", creator, id u64 LE] */
export function sessionPda(programId: PublicKey, creator: PublicKey, id: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SESSION_SEED, creator.toBuffer(), u64le(id)], programId);
}

/** ["vault", session, [i]] */
export function vaultPda(programId: PublicKey, session: PublicKey, i: 0 | 1): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_SEED, session.toBuffer(), Buffer.from([i])], programId);
}

/** b"CPIAUCNS" zero-padded to 16 bytes. */
export function seriesCode(id: string): number[] {
  const b = Buffer.from(id, "ascii");
  if (b.length > 16) throw new Error(`series id ${id} is longer than 16 bytes`);
  return [...Buffer.concat([b, Buffer.alloc(16 - b.length)])];
}

const bn = (v: bigint) => new BN(v.toString());
const bytes = (b: Buffer) => [...b];

/**
 * Demo term sheet for the params layout: product 0 = Cooling (MaxMove, +1, cap D_cap),
 * product 1 = Excess (Accumulate, +1, threshold K, cap A_cap), as documented in PR #7's state.rs.
 */
function products(r: Replay) {
  return [
    { kind: { MaxMove: {} }, direction: 1, threshold: bn(0n), cap: bn(r.dCap) },
    { kind: { Accumulate: {} }, direction: 1, threshold: bn(r.k), cap: bn(r.aCap) },
  ];
}

/** Instruction args keyed by the IDL's (snake_case) names, ready for BorshCoder. */
export function createSessionArgs(layout: Layout, r: Replay, s: SessionInputs): Record<string, unknown> {
  if (layout === "flat") {
    return {
      session_id: bn(s.id),
      k: bn(r.k),
      d_cap: bn(r.dCap),
      a_cap: bn(r.aCap),
      deposit_deadline: bn(s.depositDeadline),
      replay_deadline: bn(s.replayDeadline),
      dataset_id: bytes(r.datasetId),
      c0: bytes(r.c0),
      terminal: bytes(r.cN),
    };
  }
  return {
    nonce: bn(s.id),
    params: {
      controller: s.controller,
      deposit_deadline: bn(s.depositDeadline),
      replay_deadline: bn(s.replayDeadline),
      // Not defined by either branch yet; see docs/DECISIONS.md.
      term_sheet_hash: Array(32).fill(0),
      dataset_id: bytes(r.datasetId),
      source_digest: bytes(r.sha256OfRaw),
      series_code: seriesCode(r.seriesId),
      start_period: r.firstPeriodId,
      expected_count: r.n,
      products: products(r),
      initial_commitment: bytes(r.c0),
      terminal_commitment: bytes(r.cN),
    },
  };
}

/** Account metas in IDL order; each IDL account name must map to a known key. */
export function createSessionKeys(idl: Idl, s: SessionInputs) {
  const programId = new PublicKey(idl.address);
  const [session] = sessionPda(programId, s.creator, s.id);
  const known: Record<string, PublicKey> = {
    creator: s.creator,
    authority: s.creator,
    session,
    mint: s.mint,
    play_mint: s.mint,
    vault_0: vaultPda(programId, session, 0)[0],
    vault_1: vaultPda(programId, session, 1)[0],
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  };
  return createSessionIdl(idl).accounts.map((a) => {
    if (!("name" in a) || "accounts" in a) throw new Error("create_session: nested account groups are not supported");
    const pubkey = known[a.name];
    if (!pubkey) throw new Error(`create_session: unknown account ${a.name}`);
    return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
  });
}

export function createSessionIx(idl: Idl, r: Replay, s: SessionInputs): TransactionInstruction {
  const data = new BorshCoder(idl).instruction.encode("create_session", createSessionArgs(detectLayout(idl), r, s));
  return new TransactionInstruction({
    programId: new PublicKey(idl.address),
    keys: createSessionKeys(idl, s),
    data,
  });
}

/**
 * The Session fields create_session sets, flattened to strings ("products[1].cap" -> "800000").
 * Bytes are hex, keys base58, enum variants lowercased.
 */
export function expectedSession(idl: Idl, r: Replay, s: SessionInputs): Record<string, string> {
  const programId = new PublicKey(idl.address);
  const [session, bump] = sessionPda(programId, s.creator, s.id);
  const [vault0, bump0] = vaultPda(programId, session, 0);
  const [vault1, bump1] = vaultPda(programId, session, 1);
  const common = {
    deposit_deadline: s.depositDeadline,
    replay_deadline: s.replayDeadline,
    dataset_id: r.datasetId,
    commitment: r.c0,
    terminal: r.cN,
    next_index: 0,
    state: "open",
    bump,
    vault_bumps: [bump0, bump1],
  };
  const fields =
    detectLayout(idl) === "flat"
      ? {
          ...common,
          authority: s.creator,
          session_id: s.id,
          play_mint: s.mint,
          vaults: [vault0, vault1],
          n_obs: r.n,
          last_period_id: 0,
          k: r.k,
          d_cap: r.dCap,
          a_cap: r.aCap,
        }
      : {
          ...common,
          creator: s.creator,
          controller: s.controller,
          mint: s.mint,
          nonce: s.id,
          term_sheet_hash: Buffer.alloc(32),
          source_digest: r.sha256OfRaw,
          series_code: Buffer.from(seriesCode(r.seriesId)),
          start_period: r.firstPeriodId,
          expected_count: r.n,
          next_period: r.firstPeriodId,
          products: products(r),
        };
  return flatten(fields);
}

function isByteArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
}

/** Flatten a decoded (or expected) account into "path" -> printable string. */
export function flatten(v: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (v instanceof PublicKey) out[prefix] = v.toBase58();
  else if (Buffer.isBuffer(v) || v instanceof Uint8Array) out[prefix] = Buffer.from(v).toString("hex");
  else if (BN.isBN(v as BNType)) out[prefix] = (v as BNType).toString();
  else if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean") out[prefix] = String(v);
  else if (typeof v === "string") out[prefix] = v;
  else if (Array.isArray(v)) {
    // Byte arrays of 16+ (hashes, series_code) read better as hex than as index lists.
    if (v.length >= 16 && isByteArray(v)) out[prefix] = Buffer.from(v).toString("hex");
    else v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
  } else if (v && typeof v === "object") {
    const keys = Object.keys(v);
    // Anchor enums decode as { Variant: {} }.
    const only = keys[0];
    if (keys.length === 1 && only !== undefined) {
      const inner = (v as Record<string, unknown>)[only];
      if (inner && typeof inner === "object" && Object.keys(inner).length === 0) {
        out[prefix] = only.toLowerCase();
        return out;
      }
    }
    for (const k of keys) flatten((v as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = String(v);
  return out;
}

export function decodeSession(idl: Idl, data: Buffer): Record<string, string> {
  return flatten(new BorshCoder(idl).accounts.decode("Session", data));
}

export interface FieldCheck {
  field: string;
  expected: string;
  actual: string | undefined;
  ok: boolean;
}

/** Compare every expected field exactly (flatten already lowercases enum variants). */
export function compareSession(expected: Record<string, string>, actual: Record<string, string>): FieldCheck[] {
  return Object.entries(expected).map(([field, exp]) => {
    const act = actual[field];
    return { field, expected: exp, actual: act, ok: act === exp };
  });
}
