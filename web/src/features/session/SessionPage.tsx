"use client";
import { useId, useMemo, useState } from "react";
import Link from "next/link";
import type { SessionOverviewResponse } from "@macropaths/client";
import { Card, EmptyState, ErrorState, GlowLineChart, Skeleton, StatusPill } from "@macropaths/ui";
import { useSessionOverview, useWalletOverview } from "@/lib/hooks";
import { useWalletConnection } from "@/features/wallet-connect";
import {
  PUBKEY_RE,
  availableYears,
  buildChartModel,
  buildHeadline,
  buildHoldings,
  buildTerms,
  buildVault,
  classifyError,
  historicalRange,
  offerText,
  peakSummary,
  replayProgress,
  replayStatus,
  statePill,
  type ChartRange,
  type HoldingCard,
} from "./model";
import styles from "./session.module.css";

export function SessionPage({ addr }: { addr: string }) {
  if (!PUBKEY_RE.test(addr)) return <NotFound />;
  return <ValidSessionPage addr={addr} />;
}

function NotFound() {
  return (
    <div className={styles.page}>
      <EmptyState
        title="Session not found"
        description="This address is not a registered MacroPaths session."
        action={<Link href="/" className={styles.link}>Back to the default session</Link>}
      />
    </div>
  );
}

function ValidSessionPage({ addr }: { addr: string }) {
  const q = useSessionOverview(addr);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) {
    if (classifyError(q.error) === "not_found") return <NotFound />;
    return (
      <div className={styles.page}>
        <ErrorState
          title="Session unavailable"
          description="We could not load this session. Please try again."
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      </div>
    );
  }
  return <SessionContent overview={q.data} />;
}

function PageSkeleton() {
  return (
    <div className={styles.page} aria-busy="true">
      <Skeleton className={styles.skeletonHeader} label="Loading session" />
      <div className={styles.hero}>
        <Skeleton className={styles.skeletonChart} label="Loading inflation path" />
        <Skeleton className={styles.skeletonSummary} label="Loading results" />
      </div>
    </div>
  );
}

function SessionContent({ overview }: { overview: SessionOverviewResponse }) {
  const s = overview.session;
  const pill = statePill(s);
  const range = historicalRange(overview.presentation, s);
  const progress = replayProgress(s);
  const replay = replayStatus(s);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{overview.presentation.label}</h1>
          <p className={styles.meta}>
            {range ? <span>{range.label}</span> : null}
            <span>Historical replay · devnet · test PLAY</span>
          </p>
        </div>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </header>

      {s.state === "Refunding" ? (
        <div className={styles.notice} role="status">
          This session is refunding. Deposits and premiums are returned; scores do not determine any amount owed.
        </div>
      ) : null}
      {replay === "complete_mismatch" ? (
        <div className={styles.alert} role="alert">
          The completed replay does not match its registered dataset. Results for this session cannot be verified.
        </div>
      ) : null}

      <div className={styles.hero}>
        <HeroChart overview={overview} />
        <ResultSummary overview={overview} />
      </div>

      <section className={styles.progress} aria-label="Replay progress">
        <div className={styles.progressText}>
          <span>{progress.label}</span>
          {replay === "complete_verified" ? <span className={styles.verified}>Replay verified</span> : null}
        </div>
        <progress max={progress.total} value={progress.recorded} className={styles.progressBar}>
          {progress.label}
        </progress>
      </section>

      <Holdings overview={overview} />
      <Vaults overview={overview} />
      <Calculation overview={overview} />
    </div>
  );
}

function HeroChart({ overview }: { overview: SessionOverviewResponse }) {
  const s = overview.session;
  const [range, setRange] = useState<ChartRange>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const years = useMemo(() => availableYears(s), [s]);
  const chart = useMemo(() => buildChartModel(s, range), [s, range]);
  const listId = useId();

  return (
    <Card className={styles.chartCard} title={chart.title} subtitle="Monthly CPI, year on year">
      {s.path.length === 0 ? (
        <EmptyState title="No readings yet" description="The inflation path appears here once the replay records its first monthly reading." />
      ) : (
        <>
          {years.length > 1 ? (
            <div className={styles.rangeControls} role="group" aria-label="Chart range (display only)">
              {(["all", ...years] as ChartRange[]).map((r) => (
                <button
                  key={String(r)}
                  type="button"
                  className={styles.rangeButton}
                  aria-pressed={range === r}
                  onClick={() => {
                    setRange(r);
                    setSelected(null);
                  }}
                >
                  {r === "all" ? "All" : r}
                </button>
              ))}
            </div>
          ) : null}
          <GlowLineChart
            title={chart.title}
            summary={chart.summary}
            series={chart.series}
            threshold={chart.threshold}
            xTicks={chart.xTicks}
            formatAxisValue={(v: number) => `${v.toFixed(0)}%`}
            variant="hero"
            selectedPointId={selected}
            onSelectedPointChange={setSelected}
          />
          <details className={styles.disclosure}>
            <summary>All readings in view ({chart.observations.length})</summary>
            <ul id={listId} className={styles.obsList}>
              {chart.observations.map((o) => (
                <li key={o.id}>
                  <span>{o.month}</span>
                  <span className={styles.num}>{o.value}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Card>
  );
}

function ResultSummary({ overview }: { overview: SessionOverviewResponse }) {
  const h = buildHeadline(overview);
  const peak = peakSummary(overview.session);
  return (
    <Card className={styles.summaryCard} title="Results">
      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt>Last replay reading</dt>
          <dd className={styles.figureValue}>{h.lastReading ? h.lastReading.value : "No readings yet"}</dd>
          <dd className={styles.figureNote}>{h.lastReading ? h.lastReading.month : "Waiting for the first month"}</dd>
        </div>
        {h.scores.map((sc) => (
          <div className={styles.figure} key={sc.key}>
            <dt>{sc.name} score</dt>
            <dd className={styles.figureValue}>{sc.value ?? "Not determined yet"}</dd>
            {sc.statistic ? <dd className={styles.figureNote}>{sc.statistic}</dd> : null}
            <dd className={styles.figureNote}>{sc.note}</dd>
          </div>
        ))}
      </dl>
      {peak ? <p className={styles.footnote}>{peak}</p> : null}
      <p className={styles.footnote}>A score is the payout factor for covers, not a probability or a return.</p>
    </Card>
  );
}

function HoldingList({ cards, emptyText }: { cards: HoldingCard[]; emptyText: string }) {
  if (cards.length === 0) return <p className={styles.muted}>{emptyText}</p>;
  return (
    <>
      {cards.map((c) => (
        <dl key={c.title} className={styles.rows}>
          {c.rows.map((r) => (
            <div key={r.label} className={styles.row}>
              <dt>{r.label}</dt>
              <dd className={styles.num}>
                {r.value}
                {r.note ? <span className={styles.rowNote}>{r.note}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ))}
    </>
  );
}

function Holdings({ overview }: { overview: SessionOverviewResponse }) {
  const { owner } = useWalletConnection();
  const w = useWalletOverview(owner);
  const model = buildHoldings(overview.session, {
    owner,
    wallet: w.data,
    isPending: w.isPending,
    isError: w.isError,
  });

  let body: React.ReactNode;
  if (model.kind === "disconnected") {
    body = <EmptyState title="Wallet not connected" description="Connect a wallet to see your covers and pool positions in this session." />;
  } else if (model.kind === "loading") {
    body = <Skeleton className={styles.skeletonHoldings} label="Loading your holdings" />;
  } else if (model.kind === "error" || model.kind === "unavailable") {
    body = (
      <ErrorState
        title="Holdings unavailable"
        description="We could not read your holdings for this session."
        onRetry={() => void w.refetch()}
        retrying={w.isFetching}
      />
    );
  } else if (model.kind === "empty") {
    body = <EmptyState title="No holdings in this session" description="This wallet has no cover or pool position here." />;
  } else {
    body = (
      <div className={styles.holdingsGrid}>
        <Card title="Your covers" as="div">
          <HoldingList cards={model.covers} emptyText="No cover in this session." />
        </Card>
        <Card title="Your pool positions" as="div">
          <HoldingList cards={model.positions} emptyText="No pool position in this session." />
        </Card>
      </div>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="session-holdings">
      <h2 id="session-holdings" className={styles.sectionTitle}>Your holdings</h2>
      {body}
      {model.kind === "ok" ? (
        <p className={styles.muted}>
          Available to claim: {model.unclaimedTotal ?? "not determined yet"}. Claiming is not available in this app yet.
        </p>
      ) : null}
    </section>
  );
}

function Vaults({ overview }: { overview: SessionOverviewResponse }) {
  const v = buildVault(overview);
  return (
    <section className={styles.section} aria-labelledby="session-vaults">
      <h2 id="session-vaults" className={styles.sectionTitle}>Pool and vaults</h2>
      <div className={styles.vaultGrid}>
        <Card title="Total deposited" subtitle="All pool contributions in this session" as="div">
          <p className={styles.bigNum}>{v.totalDeposited}</p>
          <dl className={styles.rows}>
            {v.segments.map((seg) => (
              <div key={seg.id} className={styles.row}>
                <dt>{seg.label}</dt>
                <dd className={styles.num}>{seg.amount}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.muted}>These are historical pool contributions, not current vault balances. Cover premiums are not included.</p>
        </Card>
        <Card title="Currently held in vaults" subtitle="Current token balances of the two vault accounts" as="div">
          {v.current.status === "ok" ? (
            <>
              <p className={styles.bigNum}>{v.current.total}</p>
              <dl className={styles.rows}>
                {v.current.perProduct.map((p) => (
                  <div key={p.label} className={styles.row}>
                    <dt>{p.label}</dt>
                    <dd className={styles.num}>{p.amount}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className={styles.muted}>Current vault balances are unavailable right now.</p>
          )}
        </Card>
      </div>
      <p className={styles.muted}>{offerText(overview)}</p>
    </section>
  );
}

function Calculation({ overview }: { overview: SessionOverviewResponse }) {
  const terms = buildTerms(overview.session);
  return (
    <details className={styles.disclosure}>
      <summary>How the results are calculated</summary>
      <div className={styles.explain}>
        <p>
          <strong>Inflation Cooling</strong> pays according to the largest decline in inflation from an earlier peak, divided by
          this session&apos;s decline cap and capped at 100%.
        </p>
        <p>
          <strong>Excess Inflation</strong> pays according to how far and how long inflation stays above the threshold: each
          month adds the reading&apos;s excess over the threshold, and the total is divided by this session&apos;s excess cap.
        </p>
        <p>These are this session&apos;s own test terms, fixed when the session was created. They are not research forecast caps.</p>
        <dl className={styles.rows}>
          {terms.map((t) => (
            <div key={t.label} className={styles.row}>
              <dt>{t.label}</dt>
              <dd className={styles.num}>{t.value}</dd>
            </div>
          ))}
        </dl>
        <p>
          Covers pay the score multiplied by their maximum payout. Pool positions are paid from side budgets: “More” benefits from a
          larger score for that product, “Less” from a smaller one. Before settlement, amounts are illustrations calculated from the
          recorded path.
        </p>
        <p>
          The replay re-posts a published historical CPI series month by month. Its commitment shows the replay matches the
          registered dataset; it says nothing about future inflation.
        </p>
      </div>
    </details>
  );
}
