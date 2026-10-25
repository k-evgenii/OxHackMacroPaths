// Frozen internal repository ports (docs/frontend-v2/interfaces.md "Internal repository ports").
// Type-only module: no runtime code, no RPC. It deliberately does not import "server-only" so that
// vitest and type references stay safe; concrete server modules import "server-only" themselves.
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import type {
  HistoryPageMeta,
  ResearchBundle,
  SessionOverviewResponse,
  SessionView,
  WalletActivityResponse,
  WalletOverviewResponse,
} from "@macropaths/client";

/** Decimal integer string (u64/i64), validated by the shared U64/I64 schemas. */
export type S = string;

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

export interface SessionRepository {
  listRegistered(): Promise<SessionView[]>;
  get(address: string): Promise<SessionView>;
  getManyAccounts(keys: readonly PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]>;
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
  /** Amendment 1: false means inner-instruction parentage could not be resolved (null parents are then "unknown", not "direct child"). Absent or true means resolved. */
  parentageResolved?: boolean;
  accountKeys: string[];
  instructions: InstructionNode[];
  logs: string[];
  tokenBalances: Array<{
    accountIndex: number;
    mint: string;
    owner: string | null;
    preAmount: S | null;
    postAmount: S | null;
  }>;
};

export type HistoryScope = { kind: "session" | "wallet"; address: string };
export type HistoryPageRequest = { before?: string; limit?: number; retryCursor?: string };
export type HistoryPage = HistoryPageMeta & { transactions: HistoryTransaction[] };

export interface TransactionRepository {
  page(scope: HistoryScope, request: HistoryPageRequest, context?: RpcContext): Promise<HistoryPage>;
}

// ---- frozen service signatures (implemented by workers 02-07 at their entrypoints) ----

/** worker 02, `@/server/rpc` */
export type CreateRpcReader = (admission: RpcAdmission) => RpcReader;
/** worker 03, `@/server/history` */
export type CreateTransactionRepository = (reader: RpcReader, store: CacheStore) => TransactionRepository;
/** worker 03, `@/server/history` */
export type CreateHistoryAdmission = (store: CacheStore) => RpcAdmission;
/** worker 04, `@/server/sessions` */
export type GetSessionOverview = (address: string) => Promise<SessionOverviewResponse>;
/** worker 05, `@/server/wallet/overview` */
export type GetWalletOverview = (owner: string) => Promise<WalletOverviewResponse>;
/** worker 06, `@/server/wallet/activity` */
export type GetWalletActivity = (
  owner: string,
  request: HistoryPageRequest,
  context?: RpcContext,
) => Promise<WalletActivityResponse>;
/** worker 07, `@/server/research` */
export type GetResearchBundle = () => Promise<ResearchBundle>;
