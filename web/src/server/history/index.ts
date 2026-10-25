// @/server/history entrypoint (owned by worker 03).
//
// Composition: the configured repository uses worker 02's admitted reader
// (`createRpcReader(admission)`) with this module's admission and store. Agent 15 installs the
// shared Redis adapter at startup via `configureHistoryRedis`; until then (or in local/fixture
// runs) a process-local store is used, which never issues retry cursors.
import { createRpcReader } from "@/server/rpc";
import { createHistoryAdmission } from "./admission";
import { createTransactionRepository } from "./repository";
import { MemoryCacheStore, RedisCacheStore, type RedisCommands } from "./store";
import type { CacheStore, HistoryPage, HistoryPageRequest, HistoryScope, RpcContext, TransactionRepository } from "./types";

export * from "./types";
export { createHistoryAdmission, AdmissionTimeout, MAX_ACTIVE, LEASE_TTL_MS } from "./admission";
export {
  createTransactionRepository,
  txCacheKey,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  REQUEST_BUDGET_MS,
  SNAPSHOT_TTL_S,
  FINALIZED_TTL_S,
  CONFIRMED_TTL_S,
} from "./repository";
export { MemoryCacheStore, RedisCacheStore, DEL_IF_EQUALS_LUA, type RedisCommands } from "./store";
export { normalizeTransaction, NORMALIZER_VERSION } from "./normalize";
export { eventsForSession, getSessionEventsPage, eventId, type SessionEvent, type SessionEventsPage } from "./events";
export { parseHistoryQuery } from "./query";

let store: CacheStore | null = null;
let repository: TransactionRepository | null = null;

/** Install the shared Redis command adapter (composition root, worker 15). */
export function configureHistoryRedis(redis: RedisCommands): void {
  store = new RedisCacheStore(redis);
  repository = null;
}

function configured(): TransactionRepository {
  if (!repository) {
    store ??= new MemoryCacheStore();
    repository = createTransactionRepository(createRpcReader(createHistoryAdmission(store)), store);
  }
  return repository;
}

/** The configured process-wide transaction repository. */
export const transactionRepository: TransactionRepository = {
  page: (scope: HistoryScope, request: HistoryPageRequest, context?: RpcContext): Promise<HistoryPage> =>
    configured().page(scope, request, context),
};
