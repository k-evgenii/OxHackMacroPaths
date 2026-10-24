/**
 * Generic program access from the IDL: instructions with accounts matched by IDL name, account
 * decoding, and data/session.json (written by run.ts, read by admin.ts and replay.ts).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PublicKey, TransactionInstruction, type Connection } from "@solana/web3.js";
import anchor, { type Idl } from "@anchor-lang/core";

const { BN, BorshCoder } = anchor;

export const POSITION_SEED = Buffer.from("position");
/** PLAY has 6 decimals: 1 PLAY = 1_000_000 base units. */
export const PLAY = 1_000_000n;

export interface AccountMeta {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

/** Account metas in IDL order; each IDL account name must be in `known`. */
export function accountMetas(idl: Idl, name: string, known: Record<string, PublicKey>): AccountMeta[] {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`IDL has no ${name} instruction`);
  return ix.accounts.map((a) => {
    if (!("name" in a) || "accounts" in a) throw new Error(`${name}: nested account groups are not supported`);
    const pubkey = known[a.name];
    if (!pubkey) throw new Error(`${name}: unknown account ${a.name}`);
    return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
  });
}

export function instruction(
  idl: Idl,
  name: string,
  args: Record<string, unknown>,
  known: Record<string, PublicKey>,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(idl.address),
    keys: accountMetas(idl, name, known),
    data: new BorshCoder(idl).instruction.encode(name, args),
  });
}

/** ["position", session, owner] */
export function positionPda(programId: PublicKey, session: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POSITION_SEED, session.toBuffer(), owner.toBuffer()], programId);
}

/** Decode an account of IDL type `type`, or null if it does not exist. */
export async function fetchDecoded(
  connection: Connection,
  idl: Idl,
  type: string,
  address: PublicKey,
): Promise<Record<string, any> | null> {
  const info = await connection.getAccountInfo(address);
  if (!info) return null;
  if (!info.owner.equals(new PublicKey(idl.address))) {
    throw new Error(`${address.toBase58()} is owned by ${info.owner.toBase58()}, not the program`);
  }
  return new BorshCoder(idl).accounts.decode(type, info.data);
}

/** { Running: {} } -> "running" */
export function enumName(v: unknown): string {
  const k = v && typeof v === "object" ? Object.keys(v)[0] : undefined;
  if (!k) throw new Error("not an Anchor enum value");
  return k.toLowerCase();
}

/** BN or number from a decoded account -> bigint. */
export function big(v: unknown): bigint {
  if (typeof v === "number" || typeof v === "bigint") return BigInt(v);
  if (BN.isBN(v as InstanceType<typeof BN>)) return BigInt((v as InstanceType<typeof BN>).toString());
  throw new Error("not an integer");
}

export function bn(v: bigint): InstanceType<typeof BN> {
  return new BN(v.toString());
}

/** 90_000_000n -> "90"; 90_500_000n -> "90.5" */
export function play(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % PLAY).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / PLAY}${frac ? "." + frac : ""}`;
}

/** "90" or "90.5" PLAY -> base units. */
export function parsePlay(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s.trim());
  if (!m) throw new Error(`not a PLAY amount: ${s}`);
  return BigInt(m[1]!) * PLAY + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** data/session.json: what run.ts created, so the other scripts can find it. */
export interface SessionFile {
  programId: string;
  session: string;
  vaults: [string, string];
  mint: string;
  sessionId: string;
  creator: string;
  depositDeadline: string;
  replayDeadline: string;
  createSignature: string | null;
}

export function readSessionFile(file: string): SessionFile {
  if (!existsSync(file)) throw new Error(`${file} not found: run session:create first`);
  return JSON.parse(readFileSync(file, "utf8")) as SessionFile;
}

export function writeSessionFile(file: string, f: SessionFile): void {
  writeFileSync(file, JSON.stringify(f, null, 2) + "\n");
}

/** The session file must be for the IDL's program. */
export function requireProgram(idl: Idl, f: SessionFile): void {
  if (f.programId !== idl.address) throw new Error(`session file is for program ${f.programId}, IDL is ${idl.address}`);
}
