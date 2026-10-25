// Wallet action history: the shared owner-scoped transaction page, decoded into
// per-action rows. All RPC/pagination/retry snapshots belong to the shared
// TransactionRepository (worker 03); this module never opens its own connection.
import { decodeWalletActivity } from "./decode/attribute";
import type {
  HistoryPageRequest,
  RegisteredSession,
  RpcContext,
  TransactionRepository,
  WalletActivityItem,
  WalletActivityResponse,
} from "./decode/ports";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;
export const BUDGET_MS = 20_000;

export type WalletActivityDeps = {
  transactions: TransactionRepository;
  listSessions: () => Promise<RegisteredSession[]>;
  now?: () => number;
};

export function createWalletActivity(deps: WalletActivityDeps) {
  const now = deps.now ?? Date.now;
  return async function walletActivity(
    owner: string,
    request: HistoryPageRequest,
    context?: RpcContext,
  ): Promise<WalletActivityResponse> {
    const req: HistoryPageRequest = request.retryCursor
      ? { retryCursor: request.retryCursor }
      : { before: request.before, limit: clampLimit(request.limit) };
    const ctx: RpcContext = { ...context, deadlineAt: context?.deadlineAt ?? now() + BUDGET_MS };

    const sessions = new Map((await deps.listSessions()).map((s) => [s.address, s]));
    const page = await deps.transactions.page({ kind: "wallet", address: owner }, req, ctx);

    const seen = new Set<string>();
    const items: WalletActivityItem[] = [];
    for (const tx of page.transactions) {
      for (const item of decodeWalletActivity(tx, owner, sessions)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    }
    // nextBefore/pending/retryCursor come from the scanned signature page, independent of decoded rows.
    return { items, nextBefore: page.nextBefore, pending: page.pending, retryCursor: page.retryCursor };
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError(`limit must be an integer in 1..${MAX_LIMIT}`);
  return limit;
}

let configured: ReturnType<typeof createWalletActivity> | null = null;

/** Frozen service signature. Production dependencies come from workers 03 and 04. */
export async function getWalletActivity(
  owner: string,
  request: HistoryPageRequest,
  context?: RpcContext,
): Promise<WalletActivityResponse> {
  if (!configured) {
    const [{ transactionRepository }, { sessionRepository }] = await Promise.all([
      import("@/server/history"),
      import("@/server/sessions"),
    ]);
    configured = createWalletActivity({
      transactions: transactionRepository,
      listSessions: () => sessionRepository.listRegistered(),
    });
  }
  return configured(owner, request, context);
}
