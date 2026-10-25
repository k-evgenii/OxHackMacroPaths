"use client";
// Activity: "My activity" (wallet history, paginated with partial-page recovery owned by the
// shared query layer) and "Market" (observations derived from SessionView.path; no history requests).
import { useEffect, useId, useState, type ReactNode } from "react";
import { useWalletActivity, useSessionOverview } from "@/lib/hooks";
import { useWalletConnection } from "@/features/wallet-connect";
import { useSelectedSession } from "@/features/shell";
import { explorerUrl } from "@/lib/api-client";
import {
  KIND_TITLE,
  buildFeed,
  classifyFeedError,
  formatSignedAmount,
  formatTime,
  groupByDay,
  marketRows,
  marketSummary,
  productLabel,
  type WalletActivityItemLike,
  type WalletActivityPageLike,
} from "./model";
import styles from "./activity.module.css";

type Mode = "mine" | "market";

/** Renders only after mount so dates use the browser time zone without hydration mismatch. */
function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function ActivityPage() {
  const [mode, setMode] = useState<Mode>("mine");
  const headingId = useId();
  return (
    <main className={styles.page} aria-labelledby={headingId}>
      <h1 id={headingId} className={styles.title}>
        Activity
      </h1>
      <div role="radiogroup" aria-label="Activity view" className={styles.segmented}>
        {(
          [
            ["mine", "My activity"],
            ["market", "Market"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            className={mode === value ? styles.segmentOn : styles.segment}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "mine" ? <MyActivity onShowMarket={() => setMode("market")} /> : <MarketActivity />}
    </main>
  );
}

// ---------------- My activity ----------------

function MyActivity({ onShowMarket }: { onShowMarket: () => void }) {
  const wallet = useWalletConnection();
  const owner = wallet.status === "connected" ? wallet.owner : null;
  if (!owner) {
    return (
      <Notice title="Connect a wallet to see your activity">
        <p>My activity lists your own deposits, cover purchases, payouts and refunds. Market activity needs no wallet.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => void wallet.connect("phantom")}>
            Connect wallet
          </button>
          <button type="button" className={styles.secondary} onClick={onShowMarket}>
            Show market activity
          </button>
        </div>
      </Notice>
    );
  }
  // key: switching owner discards all page state for the previous wallet.
  return <OwnerFeed key={owner} owner={owner} />;
}

function OwnerFeed({ owner }: { owner: string }) {
  const mounted = useMounted();
  const q = useWalletActivity(owner);
  const pages = (q.data?.pages ?? []) as WalletActivityPageLike[];
  const feed = buildFeed(pages);

  if (q.status === "pending" || !mounted) return <p className={styles.muted} role="status">Loading activity…</p>;

  if (q.status === "error" && pages.length === 0) {
    return <FeedError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  }

  const now = new Date();
  const groups = groupByDay(feed.items, now);

  return (
    <section aria-label="My activity">
      {q.isRefetchError && (
        <div role="alert" className={styles.notice}>
          {classifyFeedError(q.error) === "expired"
            ? "This activity snapshot expired. Refresh to load the latest activity."
            : "Couldn’t refresh activity. Showing previously loaded rows."}{" "}
          <button type="button" className={styles.link} onClick={() => void q.refetch()}>
            Refresh
          </button>
        </div>
      )}
      {feed.pendingCount > 0 && (
        <div role="status" className={styles.notice}>
          Some transactions are still loading ({feed.pendingCount}). Rows shown are complete; missing ones will appear
          when recovered.{" "}
          {!q.isFetching && (
            <button type="button" className={styles.link} onClick={() => void q.refetch()}>
              Retry now
            </button>
          )}
        </div>
      )}

      {feed.items.length === 0 && feed.reachedEnd && (
        <Notice title="No activity yet">
          <p>This wallet has no MacroPaths deposits, cover purchases, payouts or refunds.</p>
        </Notice>
      )}

      {groups.map((g) => (
        <section key={g.key} className={styles.group} aria-label={g.label}>
          <h2 className={styles.groupTitle}>{g.label}</h2>
          <ul className={styles.list}>
            {g.items.map((it) => (
              <ActivityRow key={it.id} item={it} />
            ))}
          </ul>
        </section>
      ))}

      {feed.lastPageEmptyWithContinuation && (
        <p className={styles.muted}>No matching activity on this page. Older history may still contain activity.</p>
      )}

      {q.isFetchNextPageError && (
        <div role="alert" className={styles.notice}>
          {classifyFeedError(q.error) === "expired"
            ? "The activity snapshot expired. Refresh to start again."
            : "Couldn’t load older activity."}
        </div>
      )}

      {feed.nextBefore !== null ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? "Loading…" : q.isFetchNextPageError ? "Try loading more again" : "Load more"}
          </button>
        </div>
      ) : (
        feed.items.length > 0 && <p className={styles.muted}>Beginning of history.</p>
      )}
    </section>
  );
}

function ActivityRow({ item }: { item: WalletActivityItemLike }) {
  const amount = formatSignedAmount(item.amount);
  const title = KIND_TITLE[item.kind];
  const time = formatTime(item.blockTime);
  const dirClass =
    amount.direction === "in" ? styles.amountIn : amount.direction === "out" ? styles.amountOut : styles.amountMuted;
  return (
    <li className={styles.row}>
      <span className={styles.icon} aria-hidden="true">
        {item.kind === "CoverBought" || item.kind === "PoolDeposit" ? "↑" : "↓"}
      </span>
      <div className={styles.body}>
        <p className={styles.rowTitle}>{title}</p>
        <p className={styles.meta}>
          {productLabel(item.product)} · {time}
        </p>
      </div>
      <div className={styles.end}>
        <p className={dirClass}>{amount.text}</p>
        <a
          className={styles.link}
          href={explorerUrl("tx", item.signature)}
          target="_blank"
          rel="noreferrer"
          aria-label={`View ${title.toLowerCase()} transaction on Solana Explorer (opens in new tab)`}
        >
          Explorer
        </a>
      </div>
    </li>
  );
}

function FeedError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  const expired = classifyFeedError(error) === "expired";
  return (
    <div role="alert" className={styles.card}>
      <h2 className={styles.groupTitle}>{expired ? "Activity snapshot expired" : "Couldn’t load activity"}</h2>
      <p>{expired ? "Refresh to load the latest activity." : "The activity service is unavailable right now."}</p>
      <button type="button" className={styles.secondary} disabled={retrying} onClick={onRetry}>
        {expired ? "Refresh" : "Try again"}
      </button>
    </div>
  );
}

// ---------------- Market ----------------

function MarketActivity() {
  const selected = useSelectedSession();
  const q = useSessionOverview(selected.address ?? "");
  if (selected.status === "invalid")
    return <Notice title="Unknown session">The selected session isn’t registered.</Notice>;
  if (!selected.address || q.status === "pending")
    return <p className={styles.muted} role="status">Loading market activity…</p>;
  if (q.status === "error")
    return <FeedError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  const session = q.data.session;
  const rows = marketRows(session);
  const summary = marketSummary(session);
  return (
    <section aria-label="Market activity">
      <p className={styles.muted}>Recorded observation months, not transaction dates.</p>
      {summary && (
        <div className={styles.card}>
          <h2 className={styles.groupTitle}>{summary.title}</h2>
          <p>{summary.description}</p>
        </div>
      )}
      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.id} className={styles.row}>
              <span className={styles.icon} aria-hidden="true">
                •
              </span>
              <div className={styles.body}>
                <p className={styles.rowTitle}>{r.label}</p>
                <p className={styles.meta}>Observation {r.index + 1}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.card}>
      <h2 className={styles.groupTitle}>{title}</h2>
      {children}
    </div>
  );
}
