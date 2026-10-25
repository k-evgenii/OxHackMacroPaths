"use client";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { PRODUCT_NAMES, type SessionSummary } from "@macropaths/client";
import { Addr, Badge, Card, Countdown, ErrorState, Num, Skeleton, Stat, Table, type Column } from "@/components/ui";
import { Provenance } from "@/components/shell/Provenance";
import { forecastQuery, manifestQuery, productStatus, quoteFor } from "@/lib/artifacts";
import { fmtMillionthsPct, fmtPlay, shortAddr, useHealth, useSessions } from "@/lib/hooks";

const BADGE = { good: "ok", warn: "bad", muted: "neutral" } as const;

/** Products the program and research layer know about, with what is executable on the deployed program. */
function Products() {
  const [m, f] = useQueries({ queries: [manifestQuery, forecastQuery] });
  const err = m.error ?? f.error;
  return (
    <Card title="Products" action={<span className="text-xs text-muted">quotes are model illustrations, not live prices</span>}>
      {err ? (
        <ErrorState error={err} onRetry={() => { m.refetch(); f.refetch(); }} />
      ) : !m.data || !f.data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex flex-col">
          {m.data.products.map((p) => {
            const status = productStatus(p);
            return (
              <li key={p.key} className="flex flex-col gap-1 border-b border-border/50 py-3 text-sm last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant={BADGE[status.tone]}>{status.label}</Badge>
                </div>
                <div className="text-xs text-muted sm:text-right">
                  <div>{status.detail}</div>
                  <div className="num">
                    Illustrative seller entry quote {fmtMillionthsPct(String(Math.trunc(quoteFor(f.data, p.key))))} of the maximum payout, illustration until settlement
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <Link href="/forecast" className="text-primary hover:underline">Forecast</Link>
        <Link href="/planner" className="text-primary hover:underline">Planner</Link>
      </div>
      <Provenance className="mt-3" />
    </Card>
  );
}

const total = (s: SessionSummary) => s.sideTotals.reduce((a, b) => a + BigInt(b), 0n);

const columns: Column<SessionSummary>[] = [
  {
    key: "addr",
    header: "Session",
    cell: (s) => (
      <Link href={`/session/${s.address}`} className="font-mono text-primary hover:underline" title={s.address}>
        {shortAddr(s.address, 6)}
      </Link>
    ),
  },
  { key: "state", header: "State", cell: (s) => <Badge variant={s.state} /> },
  { key: "obs", header: "Observations", align: "right", cell: (s) => `${s.nextIndex}/${s.nObs}` },
  { key: "dep", header: "Deposited", align: "right", cell: (s) => <Num raw={total(s)}>{fmtPlay(total(s))}</Num> },
  ...PRODUCT_NAMES.map(
    (n, p): Column<SessionSummary> => ({
      key: `score${p}`,
      header: `${n} score`,
      align: "right",
      cell: (s) => <Num raw={s.scores[p]} unit="millionths">{fmtMillionthsPct(s.scores[p])}</Num>,
    }),
  ),
  { key: "deposit", header: "Deposit deadline", cell: (s) => <Countdown deadline={s.depositDeadline} /> },
  { key: "auth", header: "Authority", cell: (s) => <Addr value={s.authority} /> },
];

/** Overview page body: program status tiles and the sessions table. */
export function Overview() {
  const health = useHealth();
  const sessions = useSessions();
  const h = health.data;
  const list = sessions.data?.sessions ?? [];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">Overview</h1>
      {health.isError ? (
        <ErrorState error={health.error} onRetry={() => health.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Cluster" value={h?.cluster ?? "..."} />
          <Stat label="Current slot" value={h ? h.slot.toLocaleString("en-US") : "..."} />
          <Stat
            label="Program"
            value={h ? <Badge variant={h.executable ? "ok" : "bad"}>{h.executable ? "deployed" : "not executable"}</Badge> : "..."}
            sub={h ? <Addr value={h.programId} /> : undefined}
          />
          <Stat
            label="Sessions"
            value={sessions.data ? list.length : "..."}
            sub={sessions.data ? `${list.filter((s) => s.state === "Open" || s.state === "Running").length} live` : undefined}
          />
        </div>
      )}
      <Products />
      <Card title="Sessions">
        {sessions.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : (
          <Table columns={columns} rows={list} rowKey={(s) => s.address} empty="No sessions found" />
        )}
      </Card>
    </div>
  );
}
