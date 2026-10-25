// History ports: frozen shared declarations from @/server/contracts, plus history-internal types.
import type { CacheStore, HistoryTransaction } from "@/server/contracts";

export type {
  RpcContext,
  RpcAdmission,
  RpcReader,
  CacheStore,
  InstructionNode,
  HistoryTransaction,
  HistoryScope,
  HistoryPageRequest,
  HistoryPage,
  TransactionRepository,
} from "@/server/contracts";
export type { HistoryPageMeta } from "@macropaths/client";

/**
 * HistoryTransaction as cached by worker 03. `parentageResolved` (proposed additive amendment)
 * is false when some inner instruction's parent could not be established (missing stackHeight
 * in a multi-instruction CPI group); its `parentInnerInstructionIndex` null then means
 * "unknown", not "direct child of the top-level instruction". Consumers must treat amounts
 * attributed through such subtrees as unavailable.
 */
export type NormalizedTransaction = HistoryTransaction & { parentageResolved: boolean };

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
