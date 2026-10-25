// Frozen query keys (interfaces.md "Query and wallet interfaces"). Worker 10 owns the query
// implementations and may extend this module; these key shapes must not change.

export const queryKeys = {
  catalog: () => ["catalog"] as const,
  sessionOverview: (addr: string) => ["session", addr, "overview"] as const,
  walletOverview: (owner: string) => ["wallet", owner, "overview"] as const,
  walletActivity: (owner: string, limit = 10) => ["wallet", owner, "activity", limit] as const,
  sessionEvents: (addr: string, limit = 10) => ["session", addr, "events", limit] as const,
  researchBundle: (bundleId: string) => ["research", bundleId] as const,
} as const;

/** Infinite history query page parameter. */
export type HistoryPageParam = { before?: string; retryCursor?: string };
