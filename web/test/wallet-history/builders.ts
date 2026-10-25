// Synthetic (test-only) normalized transactions for wallet-history decoding.
import { PublicKey } from "@solana/web3.js";
import idl from "@macropaths/client/idl.json";
import { MACROPATHS_PROGRAM_ID, TOKEN_PROGRAM_ID, discriminatorOf, type ActionName } from "@/server/wallet/decode/instructions";
import type { HistoryTransaction, InstructionNode, RegisteredSession } from "@/server/wallet/decode/ports";

export const key = (n: number) => new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n : 7))).toBase58();

export const WALLET = key(1);
export const OTHER = key(2);
export const MINT = key(3);
export const OWNER_TA = key(4);
export const OTHER_TA = key(5);
export const SESSION = key(10);
export const VAULT0 = key(11);
export const VAULT1 = key(12);
export const SELLER_TA = key(13);
export const SESSION2 = key(20);
export const S2_VAULT0 = key(21);
export const S2_VAULT1 = key(22);
export const UNREGISTERED = key(30);
export const FILLER = key(40);

export function session(over: Partial<RegisteredSession> = {}): RegisteredSession {
  return { address: SESSION, playMint: MINT, vaults: [VAULT0, VAULT1], state: "Open", ...over };
}
export const session2 = (over: Partial<RegisteredSession> = {}) =>
  session({ address: SESSION2, vaults: [S2_VAULT0, S2_VAULT1], ...over });

export const sessionsMap = (...s: RegisteredSession[]) => new Map(s.map((x) => [x.address, x]));

const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const b64 = (...parts: (number[] | Buffer)[]) => Buffer.concat(parts.map((p) => Buffer.from(p))).toString("base64");
const pk = (s: string) => new PublicKey(s).toBuffer();

type Pos = { ix: number; inner?: number | null; parent?: number | null };
const loc = (p: Pos) => ({
  instructionIndex: p.ix,
  innerInstructionIndex: p.inner ?? null,
  parentInnerInstructionIndex: p.parent ?? null,
});

export function depositIx(p: Pos, amounts: [bigint, bigint, bigint, bigint], o: { owner?: string; session?: string; ta?: string; vaults?: [string, string]; programId?: string } = {}): InstructionNode {
  const v = o.vaults ?? [VAULT0, VAULT1];
  return {
    ...loc(p),
    programId: o.programId ?? MACROPATHS_PROGRAM_ID,
    accounts: [o.owner ?? WALLET, o.session ?? SESSION, FILLER, o.ta ?? OWNER_TA, v[0], v[1], TOKEN_PROGRAM_ID, FILLER],
    dataBase64: b64(discriminatorOf("deposit"), ...amounts.map(u64)),
  };
}

export function buyCoverIx(p: Pos, product: number, units: bigint, o: { owner?: string; vault?: string } = {}): InstructionNode {
  return {
    ...loc(p),
    programId: MACROPATHS_PROGRAM_ID,
    accounts: [o.owner ?? WALLET, SESSION, FILLER, FILLER, SELLER_TA, FILLER, OWNER_TA, o.vault ?? (product === 0 ? VAULT0 : VAULT1), TOKEN_PROGRAM_ID, FILLER],
    dataBase64: b64(discriminatorOf("buy_cover"), [product], u64(units)),
  };
}

export function claimIx(p: Pos, name: Extract<ActionName, "claim" | "claim_cover">, o: { session?: string; vaults?: [string, string] } = {}): InstructionNode {
  const v = o.vaults ?? [VAULT0, VAULT1];
  return {
    ...loc(p),
    programId: MACROPATHS_PROGRAM_ID,
    accounts: [WALLET, o.session ?? SESSION, FILLER, OWNER_TA, v[0], v[1], TOKEN_PROGRAM_ID],
    dataBase64: b64(discriminatorOf(name)),
  };
}

export function transferIx(p: Pos, source: string, destination: string, authority: string, amount: bigint, checked = false): InstructionNode {
  return {
    ...loc(p),
    programId: TOKEN_PROGRAM_ID,
    accounts: checked ? [source, MINT, destination, authority] : [source, destination, authority],
    dataBase64: checked ? b64([12], u64(amount), [6]) : b64([3], u64(amount)),
  };
}

const evDisc = (name: string) => (idl as unknown as { events: { name: string; discriminator: number[] }[] }).events.find((e) => e.name === name)!.discriminator;

export function claimedLog(sessionAddr: string, owner: string, amounts: [bigint, bigint], refund: boolean): string {
  return `Program data: ${b64(evDisc("Claimed"), pk(sessionAddr), pk(owner), u64(amounts[0]), u64(amounts[1]), [refund ? 1 : 0])}`;
}
export function coverBoughtLog(owner: string, product: number, units: bigint, buyerPaid: bigint, sellerPaid: bigint): string {
  return `Program data: ${b64(evDisc("CoverBought"), pk(SESSION), pk(owner), [product], u64(units), u64(buyerPaid), u64(sellerPaid))}`;
}
export const programLogs = (...data: string[]) => [
  `Program ${MACROPATHS_PROGRAM_ID} invoke [1]`,
  ...data,
  `Program ${MACROPATHS_PROGRAM_ID} success`,
];

let sigN = 0;
export function sig(n = ++sigN): string {
  return new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n : 9))).toBase58().repeat(2).slice(0, 87);
}

export function tx(instructions: InstructionNode[], over: Partial<HistoryTransaction> = {}): HistoryTransaction {
  return {
    signature: over.signature ?? sig(),
    slot: 100,
    blockTime: 1_700_000_000,
    finality: "finalized",
    failed: false,
    accountKeys: [WALLET, OWNER_TA, VAULT0, VAULT1, SELLER_TA, S2_VAULT0, S2_VAULT1],
    instructions,
    logs: [],
    tokenBalances: [],
    ...over,
  };
}

/** Token balance row for an account listed in tx().accountKeys. */
export function balance(account: string, pre: string | null, post: string | null, owner: string | null = WALLET, mint = MINT) {
  const idx = [WALLET, OWNER_TA, VAULT0, VAULT1, SELLER_TA, S2_VAULT0, S2_VAULT1].indexOf(account);
  if (idx < 0) throw new Error("account not in default keys");
  return { accountIndex: idx, mint, owner, preAmount: pre, postAmount: post };
}
