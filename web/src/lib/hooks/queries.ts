// Legacy v1 query factories, kept compiling for /dev and unmigrated screens. New code imports the
// frontend-v2 factories from "@/lib/queries". `eventsQuery` is the shared v2 implementation (same key shape).
import { queryOptions } from "@tanstack/react-query";
import {
  Health,
  PositionsResponse,
  SellerResponse,
  SessionList,
  SessionView,
  type SessionState,
} from "@macropaths/client/types";
import { fetchJson } from "@/lib/api-client";

export { eventsQuery } from "@/lib/queries";

/** Legacy: poll every 5 s while the session can still change. */
export function pollFor(state: SessionState | undefined): number | false {
  return state === "Open" || state === "Running" ? 5000 : false;
}

const enc = encodeURIComponent;

/** Legacy developer health read. The client shell no longer polls slot health. */
export const healthQuery = () =>
  queryOptions({ queryKey: ["health"], queryFn: ({ signal }) => fetchJson("/api/health", Health, { signal }) });

export const sessionsQuery = () =>
  queryOptions({ queryKey: ["sessions"], queryFn: ({ signal }) => fetchJson("/api/sessions", SessionList, { signal }) });

export const sessionQuery = (addr: string) =>
  queryOptions({
    queryKey: ["session", addr],
    queryFn: ({ signal }) => fetchJson(`/api/sessions/${enc(addr)}`, SessionView, { signal }),
    refetchInterval: (q) => pollFor(q.state.data?.state),
  });

export const positionsQuery = (addr: string, state?: SessionState) =>
  queryOptions({
    queryKey: ["session", addr, "positions"],
    queryFn: ({ signal }) => fetchJson(`/api/sessions/${enc(addr)}/positions`, PositionsResponse, { signal }),
    refetchInterval: pollFor(state),
  });

export const sellerQuery = (addr: string, state?: SessionState) =>
  queryOptions({
    queryKey: ["session", addr, "seller"],
    queryFn: ({ signal }) => fetchJson(`/api/sessions/${enc(addr)}/seller`, SellerResponse, { signal }),
    refetchInterval: pollFor(state),
  });
