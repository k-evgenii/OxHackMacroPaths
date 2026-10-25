import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  eventsQuery,
  healthQuery,
  positionsQuery,
  sellerQuery,
  sessionQuery,
  sessionsQuery,
} from "./queries";

export * from "./format";
export * from "./queries";

/** Cluster, slot and program status from /api/health (polls every 5 s). */
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
