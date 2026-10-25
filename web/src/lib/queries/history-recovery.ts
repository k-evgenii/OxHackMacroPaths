"use client";
// Client-only half of the shared history helper: the bounded pending-page recovery hook. Kept out of
// ./history (and the "@/lib/queries" barrel) so server components can import the query factories
// without pulling React client hooks into the server graph.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { HistoryPageParam } from "./keys";
import {
  RECOVERY_DELAYS_MS,
  firstRecoverablePage,
  hasPendingPages,
  recoverHistoryPage,
  type HistoryData,
  type HistoryMeta,
} from "./history";

export type PendingRecovery = {
  /** Some loaded page has pending signatures. */
  pending: boolean;
  /** waiting: an automatic retry is scheduled; exhausted: automatic retries stopped (manual retry offered). */
  status: "idle" | "waiting" | "retrying" | "exhausted";
  /** Pending without a retry cursor (no shared cache): only a full refresh can help. */
  needsRefresh: boolean;
  retry(): Promise<void>;
};

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Bounded pending-page recovery: retries the first recoverable page after ~5, 15 and 30 s while the
 * document is visible, then stops. `retry()` is the manual action (also refreshes cursor-less pages).
 */
export function usePendingRecovery<T extends HistoryMeta>(args: {
  queryKey: QueryKey;
  data: HistoryData<T> | undefined;
  fetchPage: (param: HistoryPageParam, signal?: AbortSignal) => Promise<T>;
  enabled?: boolean;
}): PendingRecovery {
  const { queryKey, data, fetchPage, enabled = true } = args;
  const client = useQueryClient();
  const index = firstRecoverablePage(data);
  const cursor = index >= 0 ? data!.pages[index].retryCursor : null;
  const pending = hasPendingPages(data);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [isVisible, setVisible] = useState(visible);
  const keyRef = useRef(JSON.stringify(queryKey));
  const keyString = JSON.stringify(queryKey);

  // New scope or new page cursor => fresh attempt budget.
  useEffect(() => {
    keyRef.current = keyString;
    setAttempt(0);
  }, [keyString, index]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const on = () => setVisible(visible());
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const run = useCallback(
    async (signal?: AbortSignal) => {
      if (index < 0) return;
      setRetrying(true);
      try {
        await recoverHistoryPage(client, queryKey, index, fetchPage, signal);
      } catch {
        // A failed recovery leaves the partial page visible; the next scheduled/manual retry handles it.
      } finally {
        setRetrying(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, keyString, index, fetchPage],
  );

  useEffect(() => {
    if (!enabled || index < 0 || !isVisible || attempt >= RECOVERY_DELAYS_MS.length) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      void run(ctrl.signal).finally(() => {
        if (!ctrl.signal.aborted) setAttempt((a) => a + 1);
      });
    }, RECOVERY_DELAYS_MS[attempt]);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [enabled, index, cursor, isVisible, attempt, run]);

  const retry = useCallback(async () => {
    if (index >= 0) await run();
    else if (pending) await client.refetchQueries({ queryKey, exact: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, pending, run, client, keyString]);

  const needsRefresh = pending && index < 0;
  const status: PendingRecovery["status"] = retrying
    ? "retrying"
    : index < 0
      ? needsRefresh
        ? "exhausted"
        : "idle"
      : attempt >= RECOVERY_DELAYS_MS.length
        ? "exhausted"
        : "waiting";
  return { pending, status, needsRefresh, retry };
}
