// Shared query layer (worker 10). Query factories, frozen keys and the history helper.
// Every response is validated with the shared @macropaths/client schema inside fetchJson.
import { queryOptions } from "@tanstack/react-query";
import {
  CatalogResponse,
  EventsResponse,
  SessionOverviewResponse,
  WalletActivityResponse,
  WalletOverviewResponse,
} from "@macropaths/client/types";
import { fetchJson } from "@/lib/api-client";
import { historyPath, historyQueryOptions } from "./history";
import { queryKeys, type HistoryPageParam } from "./keys";
import { POLL_MS, sessionPollInterval } from "./polling";

export { queryKeys, type HistoryPageParam } from "./keys";
export * from "./history";
export * from "./polling";
export { researchBundleQuery, manifestQuery, forecastQuery, plannerQuery } from "./research";

const enc = encodeURIComponent;

/** Static registry/bundle metadata; no chain discovery. */
export const catalogQuery = () =>
  queryOptions({
    queryKey: queryKeys.catalog(),
    queryFn: ({ signal }) => fetchJson("/api/catalog", CatalogResponse, { signal }),
    staleTime: 10 * 60_000,
  });

/** Session overview; polls 15 s Open, 5 s Running, 60 s terminal, while visible. */
export const sessionOverviewQuery = (addr: string) =>
  queryOptions({
    queryKey: queryKeys.sessionOverview(addr),
    queryFn: ({ signal }) => fetchJson(`/api/sessions/${enc(addr)}/overview`, SessionOverviewResponse, { signal }),
    refetchInterval: (q) => sessionPollInterval(q.state.data?.session.state),
    staleTime: 4_000,
  });

/** Owner's balances and holdings for the registered set; polls every 15 s while visible. */
export const walletOverviewQuery = (owner: string) =>
  queryOptions({
    queryKey: queryKeys.walletOverview(owner),
    queryFn: ({ signal }) => fetchJson(`/api/wallet/${enc(owner)}`, WalletOverviewResponse, { signal }),
    refetchInterval: POLL_MS.wallet,
    staleTime: 4_000,
  });

export const walletActivityPath = (owner: string) => `/api/wallet/${enc(owner)}/activity`;
export const sessionEventsPath = (addr: string) => `/api/sessions/${enc(addr)}/events`;

/** Owner's action history (infinite; page param `{before?, retryCursor?}`; retry: 0). */
export const walletActivityQuery = (owner: string, limit = 10) =>
  historyQueryOptions({
    queryKey: queryKeys.walletActivity(owner, limit),
    base: walletActivityPath(owner),
    limit,
    schema: WalletActivityResponse,
  });

/** Raw session event feed (developer/Market). Same paging protocol as wallet activity. */
export const eventsQuery = (addr: string, limit = 10) =>
  historyQueryOptions({
    queryKey: queryKeys.sessionEvents(addr, limit),
    base: sessionEventsPath(addr),
    limit,
    schema: EventsResponse,
  });

/** Page fetchers for pending recovery (`usePendingRecovery`). */
export const fetchWalletActivityPage = (owner: string, limit: number) => (param: HistoryPageParam, signal?: AbortSignal) =>
  fetchJson(historyPath(walletActivityPath(owner), param, limit), WalletActivityResponse, { signal });
export const fetchSessionEventsPage = (addr: string, limit: number) => (param: HistoryPageParam, signal?: AbortSignal) =>
  fetchJson(historyPath(sessionEventsPath(addr), param, limit), EventsResponse, { signal });
