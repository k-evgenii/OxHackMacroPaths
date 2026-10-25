import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  catalogQuery,
  eventsQuery,
  fetchSessionEventsPage,
  fetchWalletActivityPage,
  queryKeys,
  researchBundleQuery,
  sessionOverviewQuery,
  usePendingRecovery,
  walletActivityQuery,
  walletOverviewQuery,
  type HistoryData,
} from "@/lib/queries";
import { healthQuery, positionsQuery, sellerQuery, sessionQuery, sessionsQuery } from "./queries";

export * from "./format";
export * from "./queries";

// ---------------------------------------------------------------------------------------------
// Frontend v2 hooks. Null owner/bundle => the query stays disabled (status "pending", fetchStatus
// "idle", data undefined): the agreed disconnected state. No request is made.
// ---------------------------------------------------------------------------------------------

/** Registry catalog: sessions with presentation labels, products, research bundle reference. */
export const useCatalog = () => useQuery(catalogQuery());

/** Session overview (session, derived scores, vault and cover offer sections). */
export function useSessionOverview(addr: string | null) {
  return useQuery({
    ...sessionOverviewQuery(addr ?? ""),
    queryKey: addr ? queryKeys.sessionOverview(addr) : (["session", null, "overview"] as unknown as ReturnType<typeof queryKeys.sessionOverview>),
    enabled: !!addr,
  });
}

/** Connected owner's balances/holdings; disabled while disconnected. */
export function useWalletOverview(owner: string | null) {
  return useQuery({
    ...walletOverviewQuery(owner ?? ""),
    queryKey: owner ? queryKeys.walletOverview(owner) : (["wallet", null, "overview"] as unknown as ReturnType<typeof queryKeys.walletOverview>),
    enabled: owner !== null,
  });
}

/**
 * Connected owner's action history plus bounded pending-page recovery (`recovery`).
 * Disabled while disconnected.
 */
export function useWalletActivity(owner: string | null, limit = 10) {
  const options = walletActivityQuery(owner ?? "", limit);
  const query = useInfiniteQuery({
    ...options,
    queryKey: owner ? options.queryKey : (["wallet", null, "activity", limit] as unknown as typeof options.queryKey),
    enabled: owner !== null,
  });
  const fetchPage = useMemo(() => fetchWalletActivityPage(owner ?? "", limit), [owner, limit]);
  const recovery = usePendingRecovery({
    queryKey: options.queryKey,
    data: owner ? (query.data as HistoryData<NonNullable<typeof query.data>["pages"][number]> | undefined) : undefined,
    fetchPage,
    enabled: owner !== null,
  });
  return { ...query, recovery };
}

/** Session event feed (Market/developer) plus bounded pending-page recovery. */
export function useSessionEvents(addr: string, limit = 10) {
  const options = eventsQuery(addr, limit);
  const query = useInfiniteQuery(options);
  const fetchPage = useMemo(() => fetchSessionEventsPage(addr, limit), [addr, limit]);
  const recovery = usePendingRecovery({ queryKey: options.queryKey,
    data: query.data as HistoryData<NonNullable<typeof query.data>["pages"][number]> | undefined,
    fetchPage,
  });
  return { ...query, recovery };
}

/** Version-keyed research bundle; disabled for a null bundle ID. */
export function useResearchBundle(bundleId: string | null) {
  return useQuery({
    ...researchBundleQuery(bundleId ?? ""),
    queryKey: bundleId ? queryKeys.researchBundle(bundleId) : (["research", null] as unknown as ReturnType<typeof queryKeys.researchBundle>),
    enabled: bundleId !== null,
  });
}

// ---------------------------------------------------------------------------------------------
// Legacy v1 hooks (kept until /dev and unmigrated screens move to the v2 hooks).
// ---------------------------------------------------------------------------------------------

/** Cluster, slot and program status from /api/health (developer pages only; not polled). */
export const useHealth = () => useQuery(healthQuery());
/** Session summaries from /api/sessions. */
export const useSessions = () => useQuery(sessionsQuery());
/** Full SessionView; polls while Open or Running. */
export const useSession = (addr: string) => useQuery(sessionQuery(addr));
/** Positions and covers; polls while the session is Open or Running. */
export function usePositions(addr: string) {
  const s = useSession(addr);
  return useQuery(positionsQuery(addr, s.data?.state));
}
/** Seller account and entry quote; polls while the session is Open or Running. */
export function useSeller(addr: string) {
  const s = useSession(addr);
  return useQuery(sellerQuery(addr, s.data?.state));
}
/** Event feed, newest first, paged with nextBefore (fetchNextPage for "Load more"). */
export const useEvents = (addr: string, limit?: number) => useInfiniteQuery(eventsQuery(addr, limit));
