// Shared frozen contracts consumed by the wallet-history decoder.
import type { SessionView } from "@macropaths/client";

export type {
  S,
  RpcContext,
  InstructionNode,
  HistoryTransaction,
  HistoryScope,
  HistoryPageRequest,
  HistoryPage,
  TransactionRepository,
} from "@/server/contracts";
export type { WalletActivityItem, WalletActivityResponse, WalletActivityKind as ActivityKind } from "@macropaths/client";

/** The subset of SessionView the decoder needs. */
export type RegisteredSession = Pick<SessionView, "address" | "playMint" | "vaults" | "state">;
