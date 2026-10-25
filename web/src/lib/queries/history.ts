"use client";

// Shared history (events / wallet activity) infinite-query helper. Page agents never implement a second
// retry loop: pending recovery lives here (`recoverHistoryPage`; the hook `usePendingRecovery` is in ./history-recovery).
//
// Protocol (interfaces.md "History response shapes"): page param `{before?, retryCursor?}`; next page via
// nextBefore; a retry sends retryCursor only and returns the complete same page, which REPLACES the matching
// page in place (never appended). Automatic TanStack error retry is disabled (`retry: 0`) and history is
// never interval-polled.
import {
  infiniteQueryOptions,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { z } from "zod";
import { fetchJson } from "@/lib/api-client";
import type { HistoryPageParam } from "./keys";

export type HistoryMeta = { nextBefore: string | null; pending: string[]; retryCursor: string | null };
export type HistoryData<T> = InfiniteData<T, HistoryPageParam>;

/** Pending-page recovery delays while visible; afterwards a manual retry is offered. */
export const RECOVERY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

/** URL for one history page. A retry carries retryCursor only (no before/limit). */
export function historyPath(base: string, param: HistoryPageParam, limit: number): string {
  if (param.retryCursor) return `${base}?${new URLSearchParams({ retryCursor: param.retryCursor })}`;
  const q = new URLSearchParams({ limit: String(limit) });
  if (param.before) q.set("before", param.before);
  return `${base}?${q}`;
}

export function nextHistoryParam(last: HistoryMeta): HistoryPageParam | undefined {
  return last.nextBefore ? { before: last.nextBefore } : undefined;
}

export function historyQueryOptions<S extends z.ZodType<HistoryMeta, z.ZodTypeDef, unknown>, K extends QueryKey>(args: {
  queryKey: K;
  base: string;
  limit: number;
  schema: S;
}) {
  const { queryKey, base, limit, schema } = args;
  return infiniteQueryOptions({
    queryKey,
    initialPageParam: {} as HistoryPageParam,
    queryFn: ({ pageParam, signal }) => fetchJson(historyPath(base, pageParam, limit), schema, { signal }) as Promise<z.infer<S>>,
    getNextPageParam: (last: z.infer<S>) => nextHistoryParam(last),
    retry: 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Index of the first page that is partial and carries a retry cursor, or -1. */
export function firstRecoverablePage<T extends HistoryMeta>(data: HistoryData<T> | undefined): number {
  return data ? data.pages.findIndex((p) => p.pending.length > 0 && p.retryCursor !== null) : -1;
}

/** True when some page is partial (pending signatures) regardless of recoverability. */
export function hasPendingPages<T extends HistoryMeta>(data: HistoryData<T> | undefined): boolean {
  return !!data?.pages.some((p) => p.pending.length > 0);
}

/** Replace page `index` in place; page params are kept so a later full refetch uses the original cursor. */
export function replaceHistoryPage<T>(data: HistoryData<T>, index: number, page: T): HistoryData<T> {
  if (index < 0 || index >= data.pages.length) return data;
  const pages = data.pages.slice();
  pages[index] = page;
  return { pages, pageParams: data.pageParams };
}

/**
 * Fetch the recovered page for `data.pages[index]` via its retryCursor and replace it in the cache.
 * A concurrent change to that page (e.g. a refetch) wins: the result is dropped if the cursor moved.
 */
export async function recoverHistoryPage<T extends HistoryMeta>(
  client: QueryClient,
  queryKey: QueryKey,
  index: number,
  fetchPage: (param: HistoryPageParam, signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | null> {
  const data = client.getQueryData<HistoryData<T>>(queryKey);
  const cursor = data?.pages[index]?.retryCursor;
  if (!cursor) return null;
  const page = await fetchPage({ retryCursor: cursor }, signal);
  let applied = false;
  client.setQueryData<HistoryData<T>>(queryKey, (current) => {
    if (!current || current.pages[index]?.retryCursor !== cursor) return current;
    applied = true;
    return replaceHistoryPage(current, index, page);
  });
  return applied ? page : null;
}

