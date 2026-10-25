"use client";
import type { SessionView } from "@macropaths/client";
import { PathChart } from "@/components/charts/PathChart";
import { CapBar } from "@/components/charts/Gauges";
import { buildSeries, capFraction, declineMarkerIndex } from "@/components/charts/series";
import { useSession } from "@/components/charts/_fallback/hooks";
import { Badge, Card, ErrorState, Skeleton, Stat } from "@/components/charts/_fallback/ui";
import { fixed, pct4, period } from "@/components/charts/_fallback/format";

export function PathView({ addr, initial }: { addr: string; initial?: SessionView }) {
  const q = useSession(addr, initial);
  if (q.error) return <main className="p-4"><ErrorState error={q.error} /></main>;
  if (!q.data) return <main className="p-4"><Skeleton className="h-80" /></main>;
  const s = q.data;
  const data = buildSeries(s.path, s.terms.k);
  const marker = declineMarkerIndex(s.path, s.stats.maxDecline);
  const last = s.path.at(-1);
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Inflation path</h1>
      <div>
        <div className="mb-1 flex justify-between text-xs opacity-70">
          <span>Observations posted</span>
          <span className="tabular-nums">{s.nextIndex} / {s.nObs}</span>
        </div>
        <div className="h-2 rounded bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={s.nObs} aria-valuenow={s.nextIndex}>
          <div className="h-2 rounded bg-[#3987e5]" style={{ width: `${(s.nextIndex / Math.max(1, s.nObs)) * 100}%` }} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card title="US CPI year-on-year, 48 months">
          {data.length ? (
            <PathChart data={data} k={Number(s.terms.k) / 1e4} marker={marker} />
          ) : (
            <p className="text-sm opacity-70">No observations yet.</p>
          )}
        </Card>
        <Card title="Running statistics">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <Stat label="Running peak" value={s.stats.peak === null ? "n/a" : pct4(s.stats.peak)} />
            <Stat label="Current period" value={last ? period(last.periodId) : "n/a"} hint={`index ${s.nextIndex}`} />
            <Stat label="k" value={pct4(s.terms.k)} />
          </div>
          <div className="mt-4 space-y-3">
            <CapBar
              label="Max decline vs d_cap"
              fraction={capFraction(s.stats.maxDecline, s.terms.dCap)}
              detail={`${fixed(s.stats.maxDecline, 4)} / ${fixed(s.terms.dCap, 4)} pp`}
            />
            <CapBar
              label="Excess vs a_cap"
              fraction={capFraction(s.stats.excessAcc, s.terms.aCap)}
              detail={`${fixed(s.stats.excessAcc, 4)} / ${fixed(s.terms.aCap, 4)} pp·mo`}
            />
          </div>
        </Card>
      </div>
      <Card title="Integrity">
        <dl className="grid gap-2 text-xs sm:grid-cols-[120px_1fr]">
          <dt className="opacity-70">Dataset id</dt>
          <dd className="break-all font-mono">{s.datasetId}</dd>
          <dt className="opacity-70">Commitment</dt>
          <dd className="break-all font-mono">{s.commitment}</dd>
          <dt className="opacity-70">Terminal</dt>
          <dd className="break-all font-mono">{s.terminal}</dd>
          <dt className="opacity-70">Match</dt>
          <dd><Badge>{s.integrityOk ? "yes" : "no"}</Badge></dd>
        </dl>
      </Card>
      <details className="rounded-lg border border-white/10 p-4">
        <summary className="cursor-pointer text-sm font-semibold">All {s.path.length} observations</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-right text-xs tabular-nums">
            <thead className="opacity-70">
              <tr><th className="text-left">Period</th><th>Value %</th><th>Peak %</th><th>Decline pp</th><th>Excess pp·mo</th></tr>
            </thead>
            <tbody>
              {s.path.map((r) => (
                <tr key={r.i} className={r.i === marker ? "bg-white/5" : undefined}>
                  <td className="text-left">{period(r.periodId)}</td>
                  <td>{fixed(r.value, 4)}</td>
                  <td>{fixed(r.peak, 4)}</td>
                  <td>{fixed(r.decline, 4)}</td>
                  <td>{fixed(r.excess, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </main>
  );
}
