# Frozen interfaces — pack version 1

This is the source of truth for the foundation checkpoint. Translate declarations into shared schemas/types before workers launch. These snippets are specifications, not production implementations. Preserve existing v1 types and routes unless an explicit change is listed here. The coordinator records the foundation SHA; workers implement against it rather than drafting alternative interfaces.

## Foundation locations and ownership

| Location | Foundation content | Worker owner after launch |
| --- | --- | --- |
| `packages/client/src/types.ts` | All response schemas below plus moved research schemas | 01 |
| `packages/client/src/presentation.ts` | Exact helper signatures and model types | 01 |
| `packages/client/fixtures/frontend-v2/**` | Clearly synthetic response scenarios | 01 |
| `web/src/server/contracts.ts` | Ports below, with type-only client imports | Coordinator/15; frozen |
| `web/src/lib/presentation/contracts.ts` | Optional web-only adapter types, without account decoding | Coordinator/15; frozen |
| `web/src/features/wallet-connect/contracts.ts` | Wallet context contract below | 10; frozen shape |
| `packages/ui/src/glow-chart/types.ts` | Chart props below | 09; frozen shape |
| `web/test/support/frontend-v2/**` | Test-only endpoint handlers and integration fixture adapters | Coordinator/15 |

A declaration-only scaffold can be checked into the foundation. Unimplemented functions must not be bound to production pages. Test fixtures and MSW/fake adapters are test-only, or selected explicitly by `NEXT_PUBLIC_USE_FIXTURES=1`; no live-mode fallback.

## Shared wire conventions

In the following TypeScript, `S` is a decimal integer string validated by existing U64/I64 schemas, not an arbitrary display string. Pubkeys use the existing Pubkey schema and actual `PublicKey` validation server-side. `Pair<T>` means `[T,T]`.

```ts
type ReadMeta = { source: 'rpc' | 'fixture'; fetchedAt: string };
type ReadSection<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable'; data: null };

type SessionPresentationMetadata = {
  label: string;
  mode: 'historical_replay';
  layout: 'v1';
  firstPeriodId: number;
  researchBundleId: string | null;
};
type ProductKey = 'cooling' | 'excess' | 'fuel';
type CatalogResponse = {
  version: 1;
  cluster: string;
  defaultSession: string;
  sessions: Array<{ address: string; presentation: SessionPresentationMetadata }>;
  products: Array<{
    key: ProductKey;
    name: string;
    description: string;
    status: 'supported' | 'research';
    productIndex: 0 | 1 | null;
  }>;
  research: { bundleId: string; path: '/api/artifacts/bundle' } | null;
};

type SessionOverviewResponse = {
  session: SessionView;
  meta: ReadMeta;
  presentation: SessionPresentationMetadata;
  derived: { currentScores: Pair<S> | null; poolDeposited: S };
  vault: ReadSection<{ amounts: Pair<S>; total: S }>;
  coverOffer: ReadSection<{
    seller: SellerView | null;
    quote: EntryQuoteView | null;
    status: 'available' | 'not_configured' | 'closed' | 'unfunded';
  }>;
};

type WalletOverviewResponse = {
  owner: string;
  meta: ReadMeta;
  balances: Array<{
    mint: string;
    read: ReadSection<{ amount: S }>;
  }>;
  holdings: Array<{
    sessionAddress: string;
    read: ReadSection<{
      position: PositionView | null;
      cover: CoverView | null;
    }>;
  }>;
};
```

`/api/catalog` is static registry/bundle metadata and performs no chain discovery. The registry additionally stores expected datasetId, nObs and `{k,dCap,aCap}`; those exact validation fields are not arbitrary product marketing metadata. For A, use actual checked fixture metadata; never copy a p90 research dataset ID.

Offer precedence: terminal state or expired deposit deadline => closed; otherwise absent/unset seller/quote => not_configured; otherwise no seller free cash => unfunded; otherwise available. RPC failure => ReadSection unavailable. These labels describe an underlying offer; transaction execution still remains unimplemented.

Balances/holdings are listed for the registered mint/session set even when one entry is unavailable. Absence after a successful read yields zero amount or null account; a failed read never does. The wire omits unrelated wallets and sessions.

## History response shapes

Extend every EventView branch's base with `session: Pubkey` and `eventIndex: nonnegative integer`. Event index counts parsed MacroPaths events in that transaction in log order, including events later excluded by a session filter. Preserve the other existing event branch fields.

```ts
type HistoryPageMeta = {
  nextBefore: string | null;
  pending: string[];
  retryCursor: string | null;
};
type EventsResponse = HistoryPageMeta & { events: EventView[] };
type WalletActivityItem = {
  id: string;
  signature: string;
  instructionIndex: number;
  innerInstructionIndex: number | null;
  session: string;
  product: 0 | 1 | null;
  slot: number;
  blockTime: number | null;
  kind: 'PoolDeposit' | 'CoverBought' | 'PoolPayout' | 'CoverPayout' | 'Refund';
  amount: S | null; // signed: outgoing < 0; incoming > 0; genuine zero allowed
  mint: string;
};
type WalletActivityResponse = HistoryPageMeta & { items: WalletActivityItem[] };
```

Action IDs use `${signature}:${instructionIndex}:${innerInstructionIndex ?? 'top'}:${kind}`. A single action involving both products produces one item with `product:null` and the summed attributed transfer amount; do not duplicate that amount into two rows. An action for one product uses its product index. Failed transactions produce no successful items.

Before must be a validated signature. Limit is decimal integer 1..25, default 10. Normal page requests accept before/limit. Retry accepts retryCursor only. A retry returns the complete same page, not a patch of just new events. Preserve original `nextBefore`. Tokens are opaque random IDs, 15-minute snapshots bound to `{kind,scope}`; invalid, expired or mismatched tokens are 400. No Redis => no cross-instance retry cursor. Successful partial pages may have empty items and pending signatures.

## Exact helper exports

```ts
type AmountSummary = {
  paid: S;
  amount: S | null;
  unclaimed: S | null;
  status: 'undetermined' | 'illustration' | 'payout' | 'refund' | 'claimed';
};
type HoldingSummary = {
  position: AmountSummary | null;
  cover: (AmountSummary & { maximumPayout: S }) | null;
  unclaimedTotal: S | null;
};
declare function sumAmounts(values: readonly S[]): S;
declare function calculateAccruedScores(session: SessionView): Pair<S> | null;
declare function summarizeHolding(
  session: SessionView,
  position: PositionView | null,
  cover: CoverView | null,
): HoldingSummary;
```

For position paid, sum deposited; for cover paid, sum premiumPaid; cover.maximumPayout is the exact sum of cover.units. sumAmounts is the approved bigint reduction seam for feature aggregates; it never combines currencies/mints or unavailable entries. Amount means total payout/refund, not net profit. Claimed preserves historical amount but unclaimed is zero. If an existing unclaimed holding has an undetermined amount, unclaimedTotal is null rather than a misleading known total. With no holdings, unclaimedTotal is '0'. Amounts use the session's existing mint.

Running uses exact current scores and temporary pool budgets; Open is undetermined; Refunding uses deposits/premiums; Settled uses view payouts. Never convert token sums to Number. Helper display status is not an on-chain state.

Add shared exact `fmtPpDifference(value,digits=2)`, `fmtPointMonths(value,digits=1)` and `fmtQuotePlay(value,digits=6)` rather than feature-local scaling helpers. Price millionths become PLAY per one PLAY maximum payout. Preserve existing formatter exports for developer compatibility.

## Internal repository ports

```ts
type RpcContext = { signal?: AbortSignal; deadlineAt?: number };
interface RpcAdmission {
  acquire(method: string, context: RpcContext): Promise<{ release(): Promise<void> }>;
  noteRateLimit(method: string, retryAfterMs: number): Promise<void>;
}
interface RpcReader {
  read<T>(method: string, op: (connection: Connection) => Promise<T>, context?: RpcContext): Promise<T>;
}
interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}
interface SessionRepository {
  listRegistered(): Promise<SessionView[]>;
  get(address: string): Promise<SessionView>;
  getManyAccounts(keys: readonly PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]>;
}
type InstructionNode = {
  instructionIndex: number;
  innerInstructionIndex: number | null;
  parentInnerInstructionIndex: number | null;
  programId: string;
  accounts: string[];
  dataBase64: string;
};
type HistoryTransaction = {
  signature: string;
  slot: number;
  blockTime: number | null;
  finality: 'confirmed' | 'finalized';
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
type HistoryScope = { kind: 'session' | 'wallet'; address: string };
type HistoryPageRequest = { before?: string; limit?: number; retryCursor?: string };
type HistoryPage = HistoryPageMeta & { transactions: HistoryTransaction[] };
interface TransactionRepository {
  page(scope: HistoryScope, request: HistoryPageRequest, context?: RpcContext): Promise<HistoryPage>;
}
```

Import Connection/PublicKey/AccountInfo as server-only types. Preserve original top-level and inner instruction indices and stack relationships; unresolved parentage is a reason to mark amount unavailable, not to assign the whole transaction delta. Normalized cached data must be JSON serializable.

Worker 02 exports `createRpcReader(admission: RpcAdmission): RpcReader` plus compatibility `rpc`, `cached`, and `mapLimit` as needed by unchanged routes. History uses the admitted reader, not a bypassing generic wrapper. Worker 03 owns `createHistoryAdmission`, cache implementations, and `createTransactionRepository`; it injects admission into the transport, avoiding circular imports. Worker 04 exports `sessionRepository` implementing SessionRepository and `getSessionOverview`. Worker 05 exports `getWalletOverview`; Worker 06 exports `getWalletActivity`. Route wrappers pass those responses through shared zod validation. Workers 05/06 do not import each other's implementations.

Concrete server entrypoints are `@/server/rpc`, `@/server/history`, `@/server/sessions`, `@/server/wallet/overview`, `@/server/wallet/activity`, and `@/server/research`. Directory entrypoints use `index.ts` owned by that directory's worker, not an additional shared barrel. Freeze these service signatures: `getSessionOverview(address: string): Promise<SessionOverviewResponse>`, `getWalletOverview(owner: string): Promise<WalletOverviewResponse>`, `getWalletActivity(owner: string, request: HistoryPageRequest, context?: RpcContext): Promise<WalletActivityResponse>`, `getResearchBundle(): Promise<ResearchBundle>`. Worker 03 exports `createTransactionRepository(reader: RpcReader, store: CacheStore): TransactionRepository` and `createHistoryAdmission(store: CacheStore): RpcAdmission`; its concrete Redis store also implements the atomic lease operations internally. A memory adapter is explicitly test/local-only. Production transaction reads instantiate these in worker03's factory, while route/service consumers obtain an exported configured `transactionRepository` from `@/server/history`.

Page snapshots retain already resolved normalized transactions for the snapshot's full 15-minute lifetime as well as the frozen signature list. Thus a short confirmed-cache TTL cannot make successful rows disappear on manual retry. This temporary page retention does not promote confirmed transactions to permanently finalized cache entries. A retry only hydrates unresolved signatures and preserves all prior resolved records.

## Research contracts

Move the baseline `Manifest`, `Forecast`, `PlannerArtifact` schemas into the client contract. Preserve legacy artifact fields for `/api/artifacts/{manifest,forecast,planner}` so developer pages can migrate deliberately. Apply finite/safe-integer checks where the existing research fields require them; research numbers are not on-chain integer fields.

Add `/api/artifacts/bundle`:

```ts
type ResearchBundle = {
  id: string;
  schemaVersion: 1;
  metadata: {
    generatedAt: string | null;
    modelCurrency: 'USD';
    moneyMeaning: 'illustrative';
    hashes: { manifest: string; forecast: string; planner: string };
    associatedSession: string | null;
  };
  terms: Array<{
    key: ProductKey;
    threshold: S | null;
    cap: S;
    units: '1e-4-pp' | '1e-4-pp-months' | '1e-4-usd-months';
    quoteMillionths: S;
    researchOnly: boolean;
  }>;
  manifest: Manifest;
  forecast: Forecast;
  planner: PlannerArtifact;
};
```

For Cooling, threshold is null; Excess uses CPI threshold; Fuel uses its gasoline threshold. Chart/adapters use explicit units. Research-only Fuel remains true for this release. Don't fabricate a generation timestamp; source retrieval times remain in validated metadata. Hash actual committed artifact bytes with SHA-256. Only permit associatedSession after exact terms, dataset/product mapping and replay association verification. Reference A has no p90 bundle association.

## Query and wallet interfaces

Worker 10 owns all shared query implementations and fetchJson. Export `catalogQuery()`, `sessionOverviewQuery(addr)`, `walletOverviewQuery(owner)`, `walletActivityQuery(owner,limit=10)`, `eventsQuery(addr,limit=10)`, and `researchBundleQuery(bundleId)` from `@/lib/queries`. Export `useCatalog`, `useSessionOverview`, `useWalletOverview(owner|null)`, `useWalletActivity(owner|null,limit=10)`, `useSessionEvents`, and `useResearchBundle(bundleId|null)` from `@/lib/hooks`.

Worker 10 also owns legacy `manifestQuery`, `forecastQuery`, and `plannerQuery` constants in `web/src/lib/queries/research.ts`. Worker 07's `web/src/lib/artifacts.ts` re-exports these constants and shared client research types/schemas; it defines no independent query keys, fetchers or schemas. Maintain these exports until developer consumers migrate. Bundle queries validate returned bundle ID against the requested ID. `fetchJson(path,schema,options?:{signal?:AbortSignal})` retains the existing two-argument signature and passes cancellation through fetch.

Keys are respectively `['catalog']`, `['session',addr,'overview']`, `['wallet',owner,'overview']`, `['wallet',owner,'activity',limit]`, `['session',addr,'events',limit]`, and `['research',bundleId]`. Null owners disable wallet queries. The history infinite-query page parameter is `{before?:string,retryCursor?:string}`. getNextPageParam uses nextBefore; pending recovery replaces the matching existing page, not appends it as a newer page. Keep retry scheduling in a shared history-query helper; page agents never implement a second retry loop. Preserve legacy hooks needed by `/dev` during migration.

```ts
type WalletConnectionValue = {
  owner: string | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  connect(wallet: 'phantom' | 'solflare'): Promise<void>;
  disconnect(): Promise<void>;
};
```

Export `WalletConnectionProvider` and `useWalletConnection()` from `@/features/wallet-connect`. Export `AppShell({children})` from `@/features/shell`. These names do not imply a data-loading connection. Do not add browser RPC to satisfy a wallet adapter provider; connection/address access is the only implemented capability. Keep any unavoidable adapter transport inert for application data; inspect the browser network to verify this.

Session selection is URL-driven. `/session/[addr]` selects its path address. Home, Activity and Products use optional `?session=<registered-address>`; absent means catalog.defaultSession. A path session wins over a conflicting query value. A malformed/unregistered explicit selection produces a visible selection error/404 and an explicit return-to-default action, never a silent fallback. Navigation preserves the selected registered address. Worker10 exports `useSelectedSession(): { address: string | null; status: 'loading' | 'ready' | 'invalid' | 'unavailable'; select(address:string): void }` from `@/features/shell`; select navigates within the current destination using the approved path/query. Until catalogue loads, address is null. No localStorage precedence or second selection store.

## Chart props

```ts
type GlowPoint = {
  id: string;
  x: number;
  value: number | null;
  label: string;
  formattedValue: string;
};
type GlowSeries = { id: string; label: string; points: GlowPoint[]; tone?: 'primary' | 'secondary' };
type GlowLineChartProps = {
  title: string;
  summary: string;
  series: GlowSeries[];
  threshold?: { value: number; label: string };
  xTicks?: Array<{ x: number; label: string }>;
  formatAxisValue: (value: number) => string;
  variant?: 'hero' | 'comparison' | 'sparkline';
  selectedPointId?: string | null;
  onSelectedPointChange?: (id: string | null) => void;
  height?: number;
  className?: string;
};
```

Export `GlowLineChart` and `GlowSparkline` (same props with variant fixed to sparkline) through the UI barrel at integration. Numeric values are bounded plotting coordinates; formattedValue comes from exact caller formatting. No raw token math in chart code. Null values remain gaps. Hero uses a single series; planner can compare two aligned stake series. Avoid treating arbitrary point IDs as dates.

Worker 08 owns primitive props and freezes them during foundation with the coordinator: preserve existing Button/Card APIs; add Skeleton, EmptyState and ErrorState with explicit retry props. StatusPill maps to the approved statuses without claiming an unavailable action is enabled.

```ts
type SkeletonProps = { className?: string; label?: string };
type EmptyStateProps = { title: string; description?: string; action?: ReactNode; className?: string };
type ErrorStateProps = { title?: string; description: string; onRetry?: () => void; retrying?: boolean; className?: string };
type PartialDataNoticeProps = { description: string; onRetry?: () => void; retrying?: boolean; className?: string };
```

Export those four named components from the UI barrel. Card/Button/StatusPill retain the inspected kit's existing props rather than adding arbitrary alternate variants during parallel development. A wrapper maps API/query errors to safe description text. No raw Error object or provider URL is rendered by a primitive.

## Bootstrap completion checklist

1. Resolve and record original frontend SHA; snapshot legacy route content for `/dev` migration.
2. Commit this documentation pack and skill folders on the frontend base.
3. Generate actual shared schemas/type declarations and minimal fixture scenarios from this file. No endpoint/runtime stub may silently succeed in live mode.
4. Install/lock common dependencies once: wallet adapters, server-only, Redis client, UI-package wiring, test/browser infrastructure and current patched Next 15/React 19 versions. Worker 15 subsequently owns modifications.
5. Freeze primitive/chart props, wallet context, query keys and repository ports. Add a test-only query/HTTP fixture harness.
6. Cover disconnected, owner-empty, A-owned, Open, Running, Settled, Refunding, claimed, section-unavailable and partial-history scenarios. Synthetic on-chain states are labelled test data.
7. Run foundation contract/type checks; no missing-import scaffold errors. Record the exact baseline commands and result. Confirm normal builds do not auto-overwrite artifacts during bootstrap verification.
8. Commit foundation, resolve `FOUNDATION_SHA`, and start all 15 worktrees from it. Subsequent interface changes are coordinator-published checkpoints, not local inventions.
