/**
 * create_session inputs, instruction and read-back, shared by run.ts.
 *
 * The program is the cursor_main one (Dev and Evgenii agreed; PR #7's layout is dropped):
 * create_session(session_id, k, d_cap, a_cap, deposit_deadline, replay_deadline, dataset_id, c0,
 * terminal). `checkIdl` fails loudly if packages/client/idl.json has different args. Every value
 * comes from data/cpi-yoy-replay.json (written by prepare.ts) or the command line.
 */
import { readFileSync } from "node:fs";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import anchor, { type Idl } from "@anchor-lang/core";
import { accountMetas, instruction } from "./program.js";

const { BN, BorshCoder } = anchor;
type BNType = InstanceType<typeof BN>;

export const SESSION_SEED = Buffer.from("session");
export const VAULT_SEED = Buffer.from("vault");
export const PLAY_DECIMALS = 6;

/** The fields of data/cpi-yoy-replay.json that create_session needs. */
export interface Replay {
  datasetId: Buffer;
  c0: Buffer;
  cN: Buffer;
  n: number;
  k: bigint;
  dCap: bigint;
  aCap: bigint;
}

/** Values that are not part of the dataset: who creates the session, which mint, when it closes. */
export interface SessionInputs {
  /** `session_id`, the session PDA seed. */
  id: bigint;
  creator: PublicKey;
  mint: PublicKey;
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
    k: int(j.K, "K"),
    dCap: int(j.D_cap, "D_cap"),
    aCap: int(j.A_cap, "A_cap"),
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

export const CREATE_SESSION_ARGS = [
  "session_id",
  "k",
  "d_cap",
  "a_cap",
  "deposit_deadline",
  "replay_deadline",
  "dataset_id",
  "c0",
  "terminal",
];

/** The IDL's create_session must take exactly the args this module encodes. */
export function checkIdl(idl: Idl): void {
  const ix = idl.instructions.find((i) => i.name === "create_session");
  if (!ix) throw new Error("IDL has no create_session instruction");
  const names = ix.args.map((a) => a.name);
  if (names.join(",") !== CREATE_SESSION_ARGS.join(",")) {
    throw new Error(`unexpected create_session args: ${names.join(", ")} (keeper expects ${CREATE_SESSION_ARGS.join(", ")})`);
  }
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

const bn = (v: bigint) => new BN(v.toString());
const bytes = (b: Buffer) => [...b];

/** Instruction args keyed by the IDL's (snake_case) names, ready for BorshCoder. */
export function createSessionArgs(r: Replay, s: SessionInputs): Record<string, unknown> {
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

function createSessionAccounts(idl: Idl, s: SessionInputs): Record<string, PublicKey> {
  const programId = new PublicKey(idl.address);
  const [session] = sessionPda(programId, s.creator, s.id);
  return {
    authority: s.creator,
    session,
    play_mint: s.mint,
    vault_0: vaultPda(programId, session, 0)[0],
    vault_1: vaultPda(programId, session, 1)[0],
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  };
}

/** Account metas in IDL order; each IDL account name must map to a known key. */
export function createSessionKeys(idl: Idl, s: SessionInputs) {
  return accountMetas(idl, "create_session", createSessionAccounts(idl, s));
}

export function createSessionIx(idl: Idl, r: Replay, s: SessionInputs): TransactionInstruction {
  checkIdl(idl);
  return instruction(idl, "create_session", createSessionArgs(r, s), createSessionAccounts(idl, s));
}

/**
 * The Session fields create_session sets, flattened to strings ("vaults[1]" -> base58).
 * Bytes are hex, keys base58, enum variants lowercased.
 */
export function expectedSession(idl: Idl, r: Replay, s: SessionInputs): Record<string, string> {
  const programId = new PublicKey(idl.address);
  const [session, bump] = sessionPda(programId, s.creator, s.id);
  const [vault0, bump0] = vaultPda(programId, session, 0);
  const [vault1, bump1] = vaultPda(programId, session, 1);
  return flatten({
    authority: s.creator,
    session_id: s.id,
    play_mint: s.mint,
    vaults: [vault0, vault1],
    dataset_id: r.datasetId,
    commitment: r.c0,
    terminal: r.cN,
    n_obs: r.n,
    next_index: 0,
    last_period_id: 0,
    state: "open",
    k: r.k,
    d_cap: r.dCap,
    a_cap: r.aCap,
    deposit_deadline: s.depositDeadline,
    replay_deadline: s.replayDeadline,
    bump,
    vault_bumps: [bump0, bump1],
  });
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
    // Byte arrays of 16+ (hashes) read better as hex than as index lists.
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
