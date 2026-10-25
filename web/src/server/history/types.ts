// History ports. These mirror docs/frontend-v2/interfaces.md ("Internal repository ports").
// At the foundation checkpoint they are re-exported from @/server/contracts instead of being
// declared here; the shapes are identical, so consumers import them from "@/server/history".
import type { Connection } from "@solana/web3.js";

export type RpcContext = { signal?: AbortSignal; deadlineAt?: number };

export interface RpcAdmission {
  acquire(method: string, context: RpcContext): Promise<{ release(): Promise<void> }>;
  noteRateLimit(method: string, retryAfterMs: number): Promise<void>;
}

export interface RpcReader {
  read<T>(method: string, op: (connection: Connection) => Promise<T>, context?: RpcContext): Promise<T>;
}

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export type InstructionNode = {
  instructionIndex: number;
  innerInstructionIndex: number | null;
  parentInnerInstructionIndex: number | null;
  programId: string;
  accounts: string[];
  dataBase64: string;
};

export type HistoryTransaction = {
  signature: string;
  slot: number;
  blockTime: number | null;
  finality: "confirmed" | "finalized";
  failed: boolean;
  accountKeys: string[];
  instructions: InstructionNode[];
  logs: string[];
  tokenBalances: Array<{
    accountIndex: number;
    mint: string;
    owner: string | null;
    preAmount: string | null;
    postAmount: string | null;
  }>;
};

export type HistoryPageMeta = { nextBefore: string | null; pending: string[]; retryCursor: string | null };
export type HistoryScope = { kind: "session" | "wallet"; address: string };
export type HistoryPageRequest = { before?: string; limit?: number; retryCursor?: string };
export type HistoryPage = HistoryPageMeta & { transactions: HistoryTransaction[] };

export interface TransactionRepository {
  page(scope: HistoryScope, request: HistoryPageRequest, context?: RpcContext): Promise<HistoryPage>;
}

/**
 * Internal extension implemented by the Redis store: atomic owner-token leases.
 * `shared` is true only when values are visible to every server instance; retry cursors are
 * issued only by a shared store.
 */
export interface LeaseStore extends CacheStore {
  readonly shared: boolean;
  /** SET key owner NX PX ttlMs. True when acquired. */
  tryLease(key: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Delete key only if it still holds `owner`. */
  releaseLease(key: string, owner: string): Promise<void>;
}

export const isLeaseStore = (s: CacheStore): s is LeaseStore =>
  typeof (s as Partial<LeaseStore>).tryLease === "function" && typeof (s as Partial<LeaseStore>).releaseLease === "function";

export const isSharedStore = (s: CacheStore): boolean => (s as Partial<LeaseStore>).shared === true;
