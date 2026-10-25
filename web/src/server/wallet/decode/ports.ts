// Structural copies of the frozen interfaces.md shapes this decoder consumes.
// They are intentionally identical to the foundation contracts
// (web/src/server/contracts.ts and packages/client/src/types.ts); after the
// foundation checkpoint they are satisfied by those types without conversion.

export type S = string;

export type RpcContext = { signal?: AbortSignal; deadlineAt?: number };

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
    preAmount: S | null;
    postAmount: S | null;
  }>;
};

export type HistoryPageMeta = { nextBefore: string | null; pending: string[]; retryCursor: string | null };
export type HistoryScope = { kind: "session" | "wallet"; address: string };
export type HistoryPageRequest = { before?: string; limit?: number; retryCursor?: string };
export type HistoryPage = HistoryPageMeta & { transactions: HistoryTransaction[] };

export interface TransactionRepository {
  page(scope: HistoryScope, request: HistoryPageRequest, context?: RpcContext): Promise<HistoryPage>;
}

/** The subset of SessionView the decoder needs. */
export type RegisteredSession = {
  address: string;
  playMint: string;
  vaults: [string, string];
  state: "Open" | "Running" | "Settled" | "Refunding";
};

export type ActivityKind = "PoolDeposit" | "CoverBought" | "PoolPayout" | "CoverPayout" | "Refund";

export type WalletActivityItem = {
  id: string;
  signature: string;
  instructionIndex: number;
  innerInstructionIndex: number | null;
  session: string;
  product: 0 | 1 | null;
  slot: number;
  blockTime: number | null;
  kind: ActivityKind;
  amount: S | null;
  mint: string;
};

export type WalletActivityResponse = HistoryPageMeta & { items: WalletActivityItem[] };
