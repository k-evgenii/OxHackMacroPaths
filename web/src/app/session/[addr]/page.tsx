"use client";
import { useParams } from "next/navigation";
import { PRODUCT_NAMES, type SessionView } from "@macropaths/client";
import { Addr, Badge, Card, Countdown, ErrorState, Num, Skeleton, Stat } from "@/components/ui";
import { fmtMillionthsPct, fmtPeriod, fmtPlay, fmtPp, fmtPpMonths, fmtTime, useSession } from "@/lib/hooks";

const SIDES = ["more", "less"] as const;

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function Hash({ v }: { v: string }) {
  return (
    <span className="block break-all font-mono text-xs" title={v}>
      {v}
    </span>
  );
}

const play = (v: string) => (
  <Num raw={v} unit="PLAY base units">
    {fmtPlay(v)}
  </Num>
);

function Products({ s }: { s: SessionView }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PRODUCT_NAMES.map((name, p) => (
        <Card key={name} title={`Product ${p}: ${name}`}>
          <dl>
            {SIDES.map((side, k) => {
              const j = p * 2 + k;
              return (
                <Row key={side} label={`Side ${side} (j=${j}) total`}>
                  {play(s.sideTotals[j])}
                </Row>
              );
            })}
            <Row label="Matched">{play(s.matched[p])}</Row>
            <Row label="Score">
              <Num raw={s.scores[p]} unit="millionths">
                {fmtMillionthsPct(s.scores[p])}
              </Num>
            </Row>
            {SIDES.map((side, k) => {
              const j = p * 2 + k;
              return (
                <Row key={side} label={`Budget p / r, ${side}`}>
                  {play(s.pBudget[j])} / {play(s.rBudget[j])}
                </Row>
              );
            })}
          </dl>
        </Card>
      ))}
    </div>
  );
}

export default function SummaryPage() {
  const { addr } = useParams<{ addr: string }>();
  const q = useSession(addr);
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="State" value={<Badge variant={s.state} />} sub={`session id ${s.sessionId}`} />
        <Stat label="Observations" value={`${s.nextIndex} / ${s.nObs}`} sub={`last period ${fmtPeriod(s.lastPeriodId)}`} />
        <Stat label="Deposit deadline" value={<Countdown deadline={s.depositDeadline} />} sub={fmtTime(s.depositDeadline)} />
        <Stat label="Replay deadline" value={<Countdown deadline={s.replayDeadline} />} sub={fmtTime(s.replayDeadline)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Terms">
          <dl>
            <Row label="k (threshold)">
              <Num raw={s.terms.k} unit="1e-4 pp">{fmtPp(s.terms.k)}</Num>
            </Row>
            <Row label="d_cap (decline cap)">
              <Num raw={s.terms.dCap} unit="1e-4 pp">{fmtPp(s.terms.dCap)}</Num>
            </Row>
            <Row label="a_cap (excess cap)">
              <Num raw={s.terms.aCap} unit="1e-4 pp-months">{fmtPpMonths(s.terms.aCap)}</Num>
            </Row>
          </dl>
        </Card>
        <Card title="Path statistics">
          <dl>
            <Row label="Peak">
              {s.stats.peak == null ? (
                <span className="text-muted">none yet</span>
              ) : (
                <Num raw={s.stats.peak} unit="1e-4 pp">{fmtPp(s.stats.peak)}</Num>
              )}
            </Row>
            <Row label="Max decline">
              <Num raw={s.stats.maxDecline} unit="1e-4 pp">{fmtPp(s.stats.maxDecline)}</Num>
            </Row>
            <Row label="Excess accumulated">
              <Num raw={s.stats.excessAcc} unit="1e-4 pp-months">{fmtPpMonths(s.stats.excessAcc)}</Num>
            </Row>
          </dl>
        </Card>
      </div>

      <Products s={s} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Counts">
          <dl>
            <Row label="Positions">{s.counts.positions}</Row>
            <Row label="Positions claimed">{s.counts.claimed}</Row>
            <Row label="Covers">{s.counts.covers}</Row>
            <Row label="Covers claimed">{s.counts.coversClaimed}</Row>
            <Row label="Seller products open">{s.counts.sellerProductsOpen}</Row>
          </dl>
        </Card>
        <Card title="Accounts">
          <dl>
            <Row label="Session"><Addr value={s.address} /></Row>
            <Row label="Authority"><Addr value={s.authority} /></Row>
            <Row label="PLAY mint"><Addr value={s.playMint} /></Row>
            {s.vaults.map((v, p) => (
              <Row key={v} label={`Vault ${p} (${PRODUCT_NAMES[p]})`}><Addr value={v} /></Row>
            ))}
          </dl>
        </Card>
      </div>

      <Card title="Data integrity" action={<Badge variant={s.integrityOk ? "ok" : "bad"}>{s.integrityOk ? "integrity ok" : "integrity mismatch"}</Badge>}>
        <dl className="flex flex-col gap-3 text-sm">
          <div><dt className="text-muted">Dataset id</dt><dd><Hash v={s.datasetId} /></dd></div>
          <div><dt className="text-muted">Commitment (running)</dt><dd><Hash v={s.commitment} /></dd></div>
          <div><dt className="text-muted">Terminal (expected)</dt><dd><Hash v={s.terminal} /></dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted">Integrity is ok when commitment equals terminal and all {s.nObs} observations are posted.</p>
      </Card>
    </div>
  );
}
