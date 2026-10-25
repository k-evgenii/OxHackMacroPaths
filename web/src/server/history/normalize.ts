// Normalize one getTransaction response (legacy or v0) into the JSON-serializable HistoryTransaction.
import { utils } from "@anchor-lang/core";
import type { HistoryTransaction, InstructionNode } from "./types";

/** Bump whenever the normalized representation changes: it is part of every cache key. */
export const NORMALIZER_VERSION = 1;

type Key = { toBase58(): string } | string;
const b58 = (k: Key) => (typeof k === "string" ? k : k.toBase58());

type CompiledIx = { programIdIndex: number; accountKeyIndexes?: number[]; accounts?: number[]; data: Uint8Array | string };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };

/** Structural subset of web3.js (Versioned)TransactionResponse that we read. */
export type RawTransaction = {
  slot: number;
  blockTime?: number | null;
  transaction: {
    message: {
      staticAccountKeys?: Key[];
      accountKeys?: Key[];
      compiledInstructions?: CompiledIx[];
      instructions?: CompiledIx[];
    };
  };
  meta: {
    err: unknown;
    logMessages?: string[] | null;
    loadedAddresses?: { writable: Key[]; readonly: Key[] } | null;
    innerInstructions?: Array<{ index: number; instructions: Array<CompiledIx & { stackHeight?: number | null }> }> | null;
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
  } | null;
};

const dataBase64 = (d: Uint8Array | string) =>
  Buffer.from(typeof d === "string" ? utils.bytes.bs58.decode(d) : d).toString("base64");

export function normalizeTransaction(
  signature: string,
  raw: RawTransaction,
  finality: HistoryTransaction["finality"],
): HistoryTransaction {
  const msg = raw.transaction.message;
  const loaded = raw.meta?.loadedAddresses;
  // v0 resolution order: static keys, then loaded writable, then loaded readonly.
  const accountKeys = [
    ...(msg.staticAccountKeys ?? msg.accountKeys ?? []).map(b58),
    ...(loaded?.writable ?? []).map(b58),
    ...(loaded?.readonly ?? []).map(b58),
  ];
  const key = (i: number) => accountKeys[i] ?? `#${i}`;
  const node = (ix: CompiledIx, instructionIndex: number, inner: number | null, parent: number | null): InstructionNode => ({
    instructionIndex,
    innerInstructionIndex: inner,
    parentInnerInstructionIndex: parent,
    programId: key(ix.programIdIndex),
    accounts: (ix.accountKeyIndexes ?? ix.accounts ?? []).map(key),
    dataBase64: dataBase64(ix.data),
  });

  const instructions: InstructionNode[] = [];
  const top = msg.compiledInstructions ?? msg.instructions ?? [];
  const innerByIndex = new Map((raw.meta?.innerInstructions ?? []).map((g) => [g.index, g.instructions]));
  top.forEach((ix, i) => {
    instructions.push(node(ix, i, null, null));
    // stackHeight 2 = direct CPI of the top-level instruction (parent null); h > 2 = child of the
    // most recent inner instruction at h-1. Missing stackHeight leaves parentage unresolved (null).
    const lastAt: number[] = [];
    (innerByIndex.get(i) ?? []).forEach((inner, j) => {
      const h = inner.stackHeight ?? null;
      const parent = h !== null && h > 2 ? (lastAt[h - 1] ?? null) : null;
      if (h !== null) {
        lastAt[h] = j;
        lastAt.length = h + 1;
      }
      instructions.push(node(inner, i, j, parent));
    });
  });

  const balances = new Map<number, HistoryTransaction["tokenBalances"][number]>();
  const entry = (b: TokenBalance) =>
    balances.get(b.accountIndex) ??
    balances
      .set(b.accountIndex, { accountIndex: b.accountIndex, mint: b.mint, owner: b.owner ?? null, preAmount: null, postAmount: null })
      .get(b.accountIndex)!;
  for (const b of raw.meta?.preTokenBalances ?? []) entry(b).preAmount = b.uiTokenAmount.amount;
  for (const b of raw.meta?.postTokenBalances ?? []) entry(b).postAmount = b.uiTokenAmount.amount;

  return {
    signature,
    slot: raw.slot,
    blockTime: raw.blockTime ?? null,
    finality,
    failed: raw.meta === null || raw.meta.err !== null,
    accountKeys,
    instructions,
    logs: raw.meta?.logMessages ?? [],
    tokenBalances: [...balances.values()].sort((a, b) => a.accountIndex - b.accountIndex),
  };
}
