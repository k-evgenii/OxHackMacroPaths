import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import {
  EventsResponse,
  Health,
  PositionsResponse,
  SellerResponse,
  SessionList,
  SessionView,
  type SessionState,
} from "@macropaths/client";
import { fetchJson } from "@/lib/api-client";

/** Poll every 5 s while the session can still change. */
export function pollFor(state: SessionState | undefined): number | false {
  return state === "Open" || state === "Running" ? 5000 : false;
}

const enc = encodeURIComponent;

export const healthQuery = () =>
  queryOptions({ queryKey: ["health"], queryFn: () => fetchJson("/api/health", Health), refetchInterval: 5000 });

export const sessionsQuery = () =>
  queryOptions({ queryKey: ["sessions"], queryFn: () => fetchJson("/api/sessions", SessionList) });

export const sessionQuery = (addr: string) =>
  queryOptions({
    queryKey: ["session", addr],
    queryFn: () => fetchJson(`/api/sessions/${enc(addr)}`, SessionView),
    refetchInterval: (q) => pollFor(q.state.data?.state),
  });

export const positionsQuery = (addr: string, state?: SessionState) =>
  queryOptions({
    queryKey: ["session", addr, "positions"],
    queryFn: () => fetchJson(`/api/sessions/${enc(addr)}/positions`, PositionsResponse),
    refetchInterval: pollFor(state),
  });

export const sellerQuery = (addr: string, state?: SessionState) =>
  queryOptions({
    queryKey: ["session", addr, "seller"],
    queryFn: () => fetchJson(`/api/sessions/${enc(addr)}/seller`, SellerResponse),
    refetchInterval: pollFor(state),
  });

export const eventsQuery = (addr: string, limit = 25) =>
  infiniteQueryOptions({
    queryKey: ["session", addr, "events", limit],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (pageParam) q.set("before", pageParam);
      return fetchJson(`/api/sessions/${enc(addr)}/events?${q}`, EventsResponse);
    },
    getNextPageParam: (last) => last.nextBefore,
  });
