// Shared transaction repository: signature-page enumeration, cached hydration and stable
// partial-page recovery. Consumed by the raw session events route and wallet activity (worker 06).
import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@macropaths/client";
import { badRequest } from "@/server/errors";
import { normalizeTransaction, NORMALIZER_VERSION, type RawTransaction } from "./normalize";
import {
  isSharedStore,
  type CacheStore,
  type HistoryPage,
  type HistoryPageRequest,
  type HistoryScope,
  type HistoryTransaction,
  type RpcContext,
  type RpcReader,
  type TransactionRepository,
} from "./types";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;
export const REQUEST_BUDGET_MS = 20_000;
export const SNAPSHOT_TTL_S = 15 * 60;
export const FINALIZED_TTL_S = 90 * 24 * 60 * 60;
export const CONFIRMED_TTL_S = 30;
export const HYDRATE_CONCURRENCY = 4;

type Finality = HistoryTransaction["finality"];

/** Frozen page stored under a retry cursor. */
export type PageSnapshot = {
  v: 1;
  kind: HistoryScope["kind"];
  address: string;
  signatures: string[];
  finality: Record<string, Finality>;
  nextBefore: string | null;
  resolved: Record<string, HistoryTransaction>;
  expiresAt: number;
};

export type RepositoryOptions = {
  cluster?: string;
  programId?: string;
  now?: () => number;
  budgetMs?: number;
  concurrency?: number;
  newCursor?: () => string;
  onMetric?: (name: string, value: number, tags?: Record<string, string>) => void;
};

export const txCacheKey = (cluster: string, programId: string, signature: string) =>
  `history:tx:v${NORMALIZER_VERSION}:${cluster}:${programId}:${signature}`;
export const snapshotKey = (cursor: string) => `history:page:${cursor}`;

const CURSOR_RE = /^[A-Za-z0-9_-]{22,64}$/;

class Pending extends Error {}

export function createTransactionRepository(
  reader: RpcReader,
  store: CacheStore,
  options: RepositoryOptions = {},
): TransactionRepository {
  const cluster = options.cluster ?? process.env.SOLANA_CLUSTER ?? "devnet";
  const programId = options.programId ?? PROGRAM_ID.toBase58();
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? REQUEST_BUDGET_MS;
  const concurrency = options.concurrency ?? HYDRATE_CONCURRENCY;
  const newCursor = options.newCursor ?? (() => randomBytes(24).toString("base64url"));
  const metric = options.onMetric ?? (() => {});
  const inflight = new Map<string, Promise<HistoryTransaction>>();

  const safeGet = async <T>(key: string): Promise<T | null> => {
    try {
      return await store.get<T>(key);
    } catch {
      return null;
    }
  };
  const safeSet = async (key: string, value: unknown, ttl: number): Promise<boolean> => {
    try {
      await store.set(key, value, ttl);
      return true;
    } catch {
      return false;
    }
  };

  /** Load one transaction: cache, then a deduplicated admitted RPC read. Throws Pending if unresolved. */
  async function load(signature: string, finality: Finality, ctx: RpcContext): Promise<HistoryTransaction> {
    const key = txCacheKey(cluster, programId, signature);
    const hit = await safeGet<HistoryTransaction>(key);
    if (hit) {
      metric("history.tx.cache_hit", 1);
      return hit;
    }
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        metric("history.tx.rpc", 1);
        const raw = (await reader.read(
          "getTransaction",
          (c) => c.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
          ctx,
        )) as unknown as RawTransaction | null;
        if (!raw || !raw.meta) throw new Pending(signature); // not visible yet: never cached as empty
        const tx = normalizeTransaction(signature, raw, finality);
        // Only finality reported by the cluster earns long retention; confirmed reads expire quickly.
        await safeSet(key, tx, tx.finality === "finalized" ? FINALIZED_TTL_S : CONFIRMED_TTL_S);
        return tx;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

  /** Bounded settled hydration. Every signature not resolved before the deadline stays pending. */
  async function hydrate(
    signatures: string[],
    finality: Record<string, Finality>,
    already: Record<string, HistoryTransaction>,
    ctx: RpcContext & { deadlineAt: number },
  ): Promise<Record<string, HistoryTransaction>> {
    const resolved: Record<string, HistoryTransaction> = { ...already };
    const todo = signatures.filter((s) => !resolved[s]);
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<"deadline">((r) => {
      timer = setTimeout(() => r("deadline"), Math.max(0, ctx.deadlineAt - now()));
    });
    const live = () => !ctx.signal?.aborted && now() < ctx.deadlineAt;
    const worker = async () => {
      while (next < todo.length && live()) {
        const sig = todo[next++];
        try {
          resolved[sig] = await load(sig, finality[sig] ?? "confirmed", ctx);
        } catch (e) {
          metric("history.tx.unresolved", 1, { reason: e instanceof Pending ? "null" : "error" });
        }
      }
    };
    try {
      await Promise.race([Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker)), expired]);
    } finally {
      clearTimeout(timer);
    }
    // Snapshot the result now: late completions after the deadline are ignored for this response.
    return { ...resolved };
  }

  return {
    async page(scope: HistoryScope, request: HistoryPageRequest, context: RpcContext = {}): Promise<HistoryPage> {
      const controller = new AbortController();
      const outer = context.signal;
      if (outer?.aborted) controller.abort();
      const onAbort = () => controller.abort();
      outer?.addEventListener("abort", onAbort, { once: true });
      const deadlineAt = Math.min(context.deadlineAt ?? Infinity, now() + budgetMs);
      const ctx = { signal: controller.signal, deadlineAt };
      try {
        let snapshot: PageSnapshot | null = null;
        let cursor: string | null = null;
        if (request.retryCursor !== undefined) {
          if (request.before !== undefined || request.limit !== undefined)
            throw badRequest("retryCursor cannot be combined with before or limit");
          if (!CURSOR_RE.test(request.retryCursor)) throw badRequest("invalid retryCursor");
          snapshot = await safeGet<PageSnapshot>(snapshotKey(request.retryCursor));
          if (!snapshot || snapshot.v !== 1 || snapshot.expiresAt <= now())
            throw badRequest("retryCursor is invalid or has expired; reload the page");
          if (snapshot.kind !== scope.kind || snapshot.address !== scope.address)
            throw badRequest("retryCursor does not belong to this history feed");
          cursor = request.retryCursor;
        } else {
          const limit = request.limit ?? DEFAULT_LIMIT;
          if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw badRequest(`limit must be an integer in 1..${MAX_LIMIT}`);
          // Enumeration failure is a whole-request error (propagates as RpcFailure -> 502).
          const sigs = await reader.read(
            "getSignaturesForAddress",
            (c) => c.getSignaturesForAddress(new PublicKey(scope.address), { before: request.before, limit }, "confirmed"),
            ctx,
          );
          const finality: Record<string, Finality> = {};
          for (const s of sigs) finality[s.signature] = s.confirmationStatus === "finalized" ? "finalized" : "confirmed";
          snapshot = {
            v: 1,
            kind: scope.kind,
            address: scope.address,
            signatures: sigs.map((s) => s.signature),
            finality,
            // Based on the scanned signatures, never on decoded events.
            nextBefore: sigs.length === limit ? sigs[sigs.length - 1].signature : null,
            resolved: {},
            expiresAt: now() + SNAPSHOT_TTL_S * 1000,
          };
        }

        const resolved = await hydrate(snapshot.signatures, snapshot.finality, snapshot.resolved, ctx);
        const pending = snapshot.signatures.filter((s) => !resolved[s]);
        const transactions = snapshot.signatures.filter((s) => resolved[s]).map((s) => resolved[s]);
        metric("history.page.pending", pending.length, { kind: scope.kind });

        let retryCursor: string | null = null;
        if (pending.length > 0 && isSharedStore(store)) {
          // Only a shared (Redis) store may back a cursor another instance can reopen.
          const token = cursor ?? newCursor();
          const ttl = Math.ceil((snapshot.expiresAt - now()) / 1000);
          if (ttl > 0 && (await safeSet(snapshotKey(token), { ...snapshot, resolved }, ttl))) retryCursor = token;
        }
        return { transactions, pending, nextBefore: snapshot.nextBefore, retryCursor };
      } finally {
        outer?.removeEventListener("abort", onAbort);
        controller.abort(); // cancel any outstanding reads
      }
    },
  };
}
