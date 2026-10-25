"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { fmtMillionthsPct, fmtPeriod, fmtPlay, fmtPp, type SessionView } from "@macropaths/client";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  GlowSparkline,
  PartialDataNotice,
  Skeleton,
  type GlowPoint,
} from "@macropaths/ui";
import { useCatalog, useSessionOverview, useWalletActivity, useWalletOverview } from "@/lib/hooks";
import { sessionOverviewQuery } from "@/lib/queries";
import { useWalletConnection } from "@/features/wallet-connect";
import { useSelectedSession } from "@/features/shell";
import {
  activityRows,
  amountLabel,
  amountText,
  balanceRows,
  buildHoldings,
  historicalRange,
  lastReading,
  ppCoordinate,
  PRODUCT_NAMES,
  PRODUCT_ORDER,
  replayStateText,
  scorePath,
  sessionLabel,
  type CoverRow,
  type HoldingsModel,
  type PositionRow,
  type ProductIndex,
} from "./model";
import styles from "./dashboard.module.css";

const ACTIVITY_LIMIT = 5;
const TX_UNAVAILABLE =
  "Transactions are not available in this release. MacroPaths currently reads devnet data only; deposits, purchases, claims and faucet requests cannot be made here.";

const PRODUCT_COPY: Record<ProductIndex, string> = {
  1: "Pays according to how far and how long inflation stays above the session's threshold.",
  0: "Pays according to the largest decline in inflation from an earlier peak.",
};

function shortAddress(a: string): string {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

function sessionHref(address: string | null): string {
  return address ? `/session/${address}` : "/";
}

/* ------------------------------------------------------------------ page */

export function Dashboard() {
  const wallet = useWalletConnection();
  const owner = wallet.status === "connected" ? wallet.owner : null;
  return (
    <div className={styles.page}>
      {owner ? <ConnectedHome owner={owner} /> : <DisconnectedHome />}
    </div>
  );
}

/* ------------------------------------------------------------------ disconnected */

function DisconnectedHome() {
  const wallet = useWalletConnection();
  const selected = useSelectedSession();
  const connecting = wallet.status === "connecting";
  return (
    <>
      <section className={styles.intro} aria-labelledby="dash-heading">
        <ul className={styles.context} aria-label="Context">
          <li>Historical replay</li>
          <li>Solana devnet</li>
          <li>Test PLAY</li>
        </ul>
        <h1 id="dash-heading" className={styles.heading}>
          Cover that pays when inflation runs hot — or cools.
        </h1>
        <p className={styles.lede}>
          Each session replays a historical run of US CPI readings on Solana devnet. Connect a wallet to read your
          own covers and pool positions; nothing is signed or sent.
        </p>
        <div className={styles.actions}>
          <Button size="lg" onClick={() => void wallet.connect("phantom")} disabled={connecting} aria-busy={connecting}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </Button>
          {selected.address ? (
            <Link className={styles.linkButton} href={sessionHref(selected.address)}>
              Explore session
            </Link>
          ) : null}
        </div>
        {wallet.status === "error" && wallet.error ? (
          <p role="alert" className={styles.notice}>
            Wallet connection failed: {wallet.error}
          </p>
        ) : null}
      </section>

      <div className={styles.products}>
        {PRODUCT_ORDER.map((p) => (
          <Card key={p} title={PRODUCT_NAMES[p]} className={styles.productCard}>
            <p className={styles.muted}>{PRODUCT_COPY[p]}</p>
          </Card>
        ))}
      </div>

      <SessionPreview />
    </>
  );
}

/* ------------------------------------------------------------------ session preview */

function SessionPreview() {
  const catalog = useCatalog();
  const selected = useSelectedSession();

  if (selected.status === "invalid") {
    return (
      <EmptyState
        title="Session not found"
        description="The selected session is not registered."
        action={
          <Link className={styles.textLink} href="/">
            Return to the default session
          </Link>
        }
      />
    );
  }
  if (selected.status === "unavailable") {
    return <ErrorState description="The session list is unavailable." onRetry={() => void catalog.refetch()} retrying={catalog.isFetching} />;
  }
  if (!selected.address) return <Skeleton className={styles.previewSkeleton} label="Loading session" />;
  return <SessionPreviewBody address={selected.address} />;
}

function SessionPreviewBody({ address }: { address: string }) {
  const overview = useSessionOverview(address);
  if (overview.isPending) return <Skeleton className={styles.previewSkeleton} label="Loading session" />;
  if (overview.isError && !overview.data) {
    return (
      <ErrorState
        description="This session could not be read right now."
        onRetry={() => void overview.refetch()}
        retrying={overview.isFetching}
      />
    );
  }

  if (!overview.data) return null;
  const { session, presentation } = overview.data;
  const range = historicalRange(session);
  const reading = lastReading(session);
  const points: GlowPoint[] = session.path.map((r) => ({
    id: `${r.i}`,
    x: r.i,
    value: ppCoordinate(r.value),
    label: fmtPeriod(r.periodId),
    formattedValue: fmtPp(r.value),
  }));

  return (
    <Card
      title={presentation.label}
      subtitle={[range ?? "No readings yet", replayStateText(session)].join(" · ")}
      className={styles.preview}
      action={
        <Link className={styles.textLink} href={sessionHref(session.address)}>
          Open session
        </Link>
      }
    >
      {overview.isRefetchError ? (
        <PartialDataNotice
          description="Showing the last successful read; refreshing failed."
          onRetry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      ) : null}
      <div className={styles.previewBody}>
        <div>
          <p className={styles.label}>Last replay reading</p>
          {reading ? (
            <p className={styles.figure}>
              {fmtPp(reading.value)} <span className={styles.muted}>CPI YoY, {reading.month}</span>
            </p>
          ) : (
            <p className={styles.figure}>Not determined yet</p>
          )}
        </div>
        {points.length > 1 ? (
          <GlowSparkline
            title="Historical CPI path"
            summary={reading ? `Replay of ${points.length} monthly readings, last ${fmtPp(reading.value)} in ${reading.month}.` : ""}
            series={[{ id: "cpi", label: "CPI year-on-year", points }]}
            formatAxisValue={(v: number) => `${v.toFixed(1)} %`}
            className={styles.spark}
          />
        ) : null}
      </div>
      <ProductScores session={session} />
    </Card>
  );
}

function ProductScores({ session }: { session: SessionView }) {
  if (session.path.length === 0) return null;
  return (
    <ul className={styles.scores}>
      {PRODUCT_ORDER.map((p) => {
        const path = scorePath(session, p);
        const last = path[path.length - 1];
        return (
          <li key={p} className={styles.scoreItem}>
            <span className={styles.label}>{PRODUCT_NAMES[p]} score</span>
            <span className={styles.scoreValue}>{last ? fmtMillionthsPct(last.score, 1) : "—"}</span>
            {path.length > 1 ? (
              <GlowSparkline
                title={`${PRODUCT_NAMES[p]} accrued score`}
                summary={`Accrued score after each replay reading, ending at ${fmtMillionthsPct(last.score, 1)}.`}
                series={[
                  {
                    id: `score-${p}`,
                    label: `${PRODUCT_NAMES[p]} score`,
                    points: path.map((s, i) => ({
                      id: `${i}`,
                      x: i,
                      value: Number(BigInt(s.score)) / 1e6,
                      label: fmtPeriod(s.periodId),
                      formattedValue: fmtMillionthsPct(s.score, 1),
                    })),
                  },
                ]}
                formatAxisValue={(v: number) => `${Math.round(v * 100)} %`}
                className={styles.miniSpark}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ connected */

function ConnectedHome({ owner }: { owner: string }) {
  const catalog = useCatalog();
  const overview = useWalletOverview(owner);
  // Never render a response that belongs to a previously connected owner.
  const data = overview.data && overview.data.owner === owner ? overview.data : undefined;

  const sessionAddrs = useMemo(() => (data ? data.holdings.map((h) => h.sessionAddress) : []), [data]);
  const sessions = useQueries({ queries: sessionAddrs.map((a) => sessionOverviewQuery(a)) });

  const holdings: HoldingsModel | null = useMemo(() => {
    if (!data) return null;
    return buildHoldings(data, (addr) => {
      const idx = sessionAddrs.indexOf(addr);
      const s = idx >= 0 ? sessions[idx]?.data : undefined;
      return s ? { session: s.session, label: s.presentation.label } : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sessionAddrs, ...sessions.map((s) => s.dataUpdatedAt)]);
  const sessionsLoading = sessions.some((s) => s.isPending);

  return (
    <>
      <AccountSummary owner={owner} cluster={catalog.data?.cluster ?? null} />

      {overview.isPending || (overview.data && !data) ? (
        <Skeleton className={styles.balanceSkeleton} label="Loading your balances" />
      ) : overview.isError && !data ? (
        <ErrorState
          title="Wallet data unavailable"
          description="Your balances and holdings could not be read right now."
          onRetry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      ) : data && holdings ? (
        <>
          {overview.isRefetchError ? (
            <PartialDataNotice
              description="Showing the last successful read; refreshing failed."
              onRetry={() => void overview.refetch()}
              retrying={overview.isFetching}
            />
          ) : null}
          <div className={styles.topGrid}>
            <Balances rows={balanceRows(data)} multi={data.balances.length > 1} />
            <Claimable holdings={holdings} loading={sessionsLoading} multi={data.balances.length > 1} />
          </div>
          {holdings.unavailable.length > 0 ? (
            <PartialDataNotice
              description={`Holdings for ${holdings.unavailable.map((u) => u.sessionLabel).join(", ")} could not be read.`}
              onRetry={() => void overview.refetch()}
              retrying={overview.isFetching}
            />
          ) : null}
          {sessionsLoading ? (
            <Skeleton className={styles.previewSkeleton} label="Loading your holdings" />
          ) : (
            <>
              <Covers rows={holdings.covers} multi={data.balances.length > 1} />
              <Positions rows={holdings.positions} multi={data.balances.length > 1} />
            </>
          )}
        </>
      ) : null}

      <SessionPreview />
      <p className={styles.note}>{TX_UNAVAILABLE}</p>
      <RecentActivity owner={owner} cluster={catalog.data?.cluster ?? "devnet"} labelFor={(a) => sessionLabel(catalog.data, a)} />
    </>
  );
}

function AccountSummary({ owner, cluster }: { owner: string; cluster: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className={styles.account} aria-label="Connected wallet">
      <h1 className={styles.headingSmall}>Your covers and positions</h1>
      <div className={styles.accountMeta}>
        <button
          type="button"
          className={styles.copy}
          onClick={() => {
            void navigator.clipboard?.writeText(owner).then(() => setCopied(true));
          }}
          aria-label={`Copy wallet address ${owner}`}
        >
          {shortAddress(owner)} {copied ? "· Copied" : ""}
        </button>
        <span className={styles.chip}>Solana {cluster ?? "devnet"}</span>
        <span className={styles.chip}>Test PLAY</span>
      </div>
    </section>
  );
}

function Balances({ rows, multi }: { rows: ReturnType<typeof balanceRows>; multi: boolean }) {
  return (
    <Card title={rows.length > 1 ? "PLAY balances" : "PLAY balance"} className={styles.balanceCard}>
      {rows.length === 0 ? <p className={styles.muted}>No registered PLAY mint.</p> : null}
      <ul className={styles.plain}>
        {rows.map((r) => (
          <li key={r.mint} className={styles.balanceRow}>
            {r.status === "ok" ? (
              <span className={rows.length === 1 ? styles.hero : styles.figure}>{r.formatted}</span>
            ) : (
              <span className={styles.unavailable}>Balance unavailable</span>
            )}
            {multi ? <span className={styles.muted}>Mint {shortAddress(r.mint)}</span> : null}
          </li>
        ))}
      </ul>
      <p className={styles.note}>Test tokens on devnet. No fiat value is assumed.</p>
    </Card>
  );
}

function Claimable({ holdings, loading, multi }: { holdings: HoldingsModel; loading: boolean; multi: boolean }) {
  return (
    <Card title="Available to claim" subtitle="Final payouts and refunds; separate from your wallet balance" className={styles.balanceCard}>
      {loading ? (
        <Skeleton label="Loading payouts" />
      ) : holdings.claimable.length === 0 ? (
        <p className={styles.figure}>{fmtPlay("0")}</p>
      ) : (
        <ul className={styles.plain}>
          {holdings.claimable.map((c) => (
            <li key={c.mint} className={styles.balanceRow}>
              <span className={styles.figure}>{c.amount === null ? "Not determined yet" : fmtPlay(c.amount)}</span>
              {multi ? <span className={styles.muted}>Mint {shortAddress(c.mint)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note}>Running illustrations are not included. Claiming is not available in this release.</p>
    </Card>
  );
}

function HoldingAmount({ row }: { row: CoverRow | PositionRow }) {
  const s = row.summary;
  return (
    <div className={styles.amount}>
      <span className={styles.label}>{amountLabel(s.status, row.refunding)}</span>
      <span className={styles.figure}>{amountText(s)}</span>
      {s.status === "illustration" ? <span className={styles.note}>Illustration until settlement</span> : null}
    </div>
  );
}

function Covers({ rows, multi }: { rows: CoverRow[]; multi: boolean }) {
  return (
    <Card title="Your covers" className={styles.section}>
      {rows.length === 0 ? (
        <EmptyState title="No covers" description="This wallet holds no cover in the registered sessions." />
      ) : (
        <ul className={styles.holdings}>
          {rows.map((r) => (
            <li key={r.key} className={styles.holding}>
              <div className={styles.holdingHead}>
                <Link className={styles.textLink} href={sessionHref(r.sessionAddress)}>
                  {r.sessionLabel}
                </Link>
                <span className={styles.muted}>{r.products.join(" + ")}</span>
                {multi ? <span className={styles.muted}>Mint {shortAddress(r.mint)}</span> : null}
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>Premium paid</dt>
                  <dd>{fmtPlay(r.premiumPaid)}</dd>
                </div>
                <div>
                  <dt>Maximum payout</dt>
                  <dd>{fmtPlay(r.maximumPayout)}</dd>
                </div>
              </dl>
              <HoldingAmount row={r} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Positions({ rows, multi }: { rows: PositionRow[]; multi: boolean }) {
  return (
    <Card title="Your pool positions" subtitle="A separate mechanism: payouts follow the pool side budgets" className={styles.section}>
      {rows.length === 0 ? (
        <EmptyState title="No pool positions" description="This wallet holds no pool position in the registered sessions." />
      ) : (
        <ul className={styles.holdings}>
          {rows.map((r) => (
            <li key={r.key} className={styles.holding}>
              <div className={styles.holdingHead}>
                <Link className={styles.textLink} href={sessionHref(r.sessionAddress)}>
                  {r.sessionLabel}
                </Link>
                {multi ? <span className={styles.muted}>Mint {shortAddress(r.mint)}</span> : null}
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>Total deposited</dt>
                  <dd>{fmtPlay(r.totalDeposited)}</dd>
                </div>
              </dl>
              <HoldingAmount row={r} />
              <details className={styles.details}>
                <summary>More/Less allocation</summary>
                <ul className={styles.plain}>
                  {r.sides.map((s) => (
                    <li key={`${s.product}-${s.side}`} className={styles.sideRow}>
                      <span>
                        {s.product} · {s.side}
                      </span>
                      <span>{fmtPlay(s.deposited)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentActivity({ owner, cluster, labelFor }: { owner: string; cluster: string; labelFor: (a: string) => string }) {
  const activity = useWalletActivity(owner, ACTIVITY_LIMIT);
  const rows = activity.data ? activityRows(activity.data.items, { limit: ACTIVITY_LIMIT, cluster, labelFor }) : [];
  return (
    <Card
      title="Recent activity"
      className={styles.section}
      action={
        <Link className={styles.textLink} href="/activity">
          All activity
        </Link>
      }
    >
      {activity.isPending ? (
        <Skeleton label="Loading recent activity" />
      ) : activity.isError && !activity.data ? (
        <ErrorState description="Recent activity could not be read." onRetry={() => void activity.refetch()} retrying={activity.isFetching} />
      ) : (
        <>
          {activity.data && activity.data.pending.length > 0 ? (
            <PartialDataNotice description="Some recent transactions are still loading. See All activity to retry." />
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title="No recent activity" description="No recognised MacroPaths actions in your latest transactions." />
          ) : (
            <ul className={styles.activity}>
              {rows.map((r) => (
                <li key={r.id} className={styles.activityRow}>
                  <div>
                    <p className={styles.activityTitle}>{r.title}</p>
                    <p className={styles.muted}>
                      {r.context} · {r.when}
                    </p>
                  </div>
                  <div className={styles.activityEnd}>
                    <span className={r.direction === "in" ? styles.in : r.direction === "unknown" ? styles.unavailable : undefined}>
                      {r.amount}
                    </span>
                    <a className={styles.textLink} href={r.explorerUrl} target="_blank" rel="noreferrer">
                      Explorer
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
