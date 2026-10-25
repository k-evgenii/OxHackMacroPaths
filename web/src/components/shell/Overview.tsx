"use client";
import Link from "next/link";
import { PRODUCT_NAMES, type SessionSummary } from "@macropaths/client";
import { Addr, Badge, Card, Countdown, ErrorState, Num, Skeleton, Stat, Table, type Column } from "@/components/ui";
import { fmtMillionthsPct, fmtPlay, shortAddr, useHealth, useSessions } from "@/lib/hooks";

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
