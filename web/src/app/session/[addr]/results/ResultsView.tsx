"use client";
import type { PositionsResponse, SessionView } from "@macropaths/client";
import { CapBar, ScoreGauge } from "@/components/charts/Gauges";
import { capFraction, coverPayout, gaugeFraction, positionPayout, totals } from "@/components/charts/series";
import { usePositions, useSession } from "@/components/charts/_fallback/hooks";
import { Badge, Card, EmptyState, ErrorState, Skeleton, Stat } from "@/components/charts/_fallback/ui";
import { fixed, millionthsPct, play, shortAddr } from "@/components/charts/_fallback/format";

const PRODUCTS = [
  { name: "Inflation Cooling", short: "Cooling", stat: "maxDecline", statName: "max_decline", cap: "dCap", unit: "pp" },
  { name: "Excess Inflation", short: "Excess", stat: "excessAcc", statName: "excess_acc", cap: "aCap", unit: "pp·mo" },
] as const;
const SIDES = ["more", "less"] as const;

export function ResultsView(props: { addr: string; initialSession?: SessionView; initialPositions?: PositionsResponse }) {
  const sq = useSession(props.addr, props.initialSession);
  const pq = usePositions(props.addr, props.initialPositions);
  const err = sq.error ?? pq.error;
  if (err) return <main className="p-4"><ErrorState error={err} /></main>;
  if (!sq.data || !pq.data) return <main className="p-4"><Skeleton className="h-80" /></main>;
  const s = sq.data;
  const { positions, covers } = pq.data;
  const note = s.state === "Settled" ? null : <Badge>illustration until settlement</Badge>;
  const t = totals(positions, s);
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Results</h1>
        <Badge>{s.state}</Badge>
        {note}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {PRODUCTS.map((p, n) => (
          <Card key={p.name} title={<span>{p.name} {note}</span>}>
            <ScoreGauge fraction={gaugeFraction(s.scores[n])} text={millionthsPct(s.scores[n])} label="score" />
            <div className="mt-3">
              <CapBar
                label={`${p.statName} vs cap`}
                fraction={capFraction(s.stats[p.stat], s.terms[p.cap])}
                detail={`${fixed(s.stats[p.stat], 4)} / ${fixed(s.terms[p.cap], 4)} ${p.unit}`}
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Matched M" value={fixed(s.matched[n], 6)} hint="PLAY" />
              {SIDES.map((side, k) => (
                <Stat
                  key={side}
                  label={`${side}: P`}
                  value={fixed(s.pBudget[n * 2 + k], 6)}
                  hint={`R ${fixed(s.rBudget[n * 2 + k], 6)}`}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Card title={<span>Positions {note}</span>}>
        {positions.length === 0 ? (
          <EmptyState title="No positions in this session" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs tabular-nums">
              <thead className="opacity-70">
                <tr><th className="text-left">Owner</th><th>Side</th><th>Deposited</th><th>Payout</th><th>Claimed</th></tr>
              </thead>
              <tbody>
                {positions.flatMap((pos) => {
                  const pay = positionPayout(pos, s);
                  return pos.deposited.map((d, j) => (
                    <tr key={`${pos.address}-${j}`} className="border-t border-white/5">
                      <td className="text-left font-mono">{j === 0 ? shortAddr(pos.owner) : ""}</td>
                      <td>{PRODUCTS[j >> 1].short} {SIDES[j & 1]}</td>
                      <td>{fixed(d, 6)}</td>
                      <td>{fixed(pay[j], 6)}</td>
                      <td>{j === 0 ? (pos.claimed ? "yes" : "no") : ""}</td>
                    </tr>
                  ));
                })}
                <tr className="border-t border-white/20 font-semibold">
                  <td className="text-left" colSpan={2}>Total</td>
                  <td>{fixed(t.deposited, 6)}</td>
                  <td>{fixed(t.payout, 6)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs opacity-70">
          Total payout {play(t.payout)} of {play(t.deposited)} deposited; dust left {play(t.dust)}.
        </p>
      </Card>
      <Card title={<span>Covers {note}</span>}>
        {covers.length === 0 ? (
          <EmptyState title="No covers bought in this session" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs tabular-nums">
              <thead className="opacity-70">
                <tr><th className="text-left">Owner</th><th>Product</th><th>Units</th><th>Premium paid</th><th>Payout</th><th>Claimed</th></tr>
              </thead>
              <tbody>
                {covers.flatMap((c) => {
                  const pay = coverPayout(c, s);
                  return PRODUCTS.map((p, n) => (
                    <tr key={`${c.address}-${n}`} className="border-t border-white/5">
                      <td className="text-left font-mono">{n === 0 ? shortAddr(c.owner) : ""}</td>
                      <td>{p.name}</td>
                      <td>{fixed(c.units[n], 6)}</td>
                      <td>{fixed(c.premiumPaid[n], 6)}</td>
                      <td>{fixed(pay[n], 6)}</td>
                      <td>{n === 0 ? (c.claimed ? "yes" : "no") : ""}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
