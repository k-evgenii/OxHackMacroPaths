"use client";
// Exposure planner: one recommendation, residual shortfall beside cash, compact chart, then the
// full 21-row comparison behind a disclosure. Research amounts are illustrative USD.
import { useMemo, useState } from "react";
import { GlowLineChart } from "@macropaths/ui";
import type { PlannerArtifact } from "@/lib/artifacts";
import { capBindingText, METHODOLOGY, PLANNER_NAME, planView, RESEARCH_USD_NOTE, usd } from "./model";
import s from "./products.module.css";

function NumberField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={s.field} htmlFor={id}>
      {label}
      <input id={id} type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const toNumber = (v: string) => (v.trim() === "" ? NaN : Number(v));

export function PlannerSection({ art }: { art: PlannerArtifact }) {
  const [gallons, setGallons] = useState(String(art.defaults.q));
  const [budget, setBudget] = useState(String(art.defaults.B));
  const view = useMemo(() => planView(art, { gallons: toNumber(gallons), budget: toNumber(budget) }), [art, gallons, budget]);

  return (
    <section aria-labelledby="planner-title" className={s.card}>
      <h2 id="planner-title" className={s.cardTitle}>Exposure planner (research)</h2>
      <p className={s.muted}>{RESEARCH_USD_NOTE}</p>
      <div className={s.inputs}>
        <NumberField id="planner-gallons" label="Gallons per month" value={gallons} onChange={setGallons} />
        <NumberField id="planner-budget" label="Illustrative budget (USD)" value={budget} onChange={setBudget} />
      </div>
      <p className={s.muted}>
        The fuel bill is budgeted at a fixed illustrative {usd(art.defaults.G)} per gallon from the research bundle; the overrun is
        spending above that price.
      </p>

      <div aria-live="polite" aria-atomic="true">
        {view.status === "invalid" ? (
          <p className={s.error} role="alert">{view.error} No recommendation is shown until the inputs are valid.</p>
        ) : (
          <>
            <p className={s.sentence}>{view.sentence}</p>
            {view.best.product === "fuel" ? (
              <p className={s.muted}>
                <span className={s.pill}>Research only</span> Fuel Research is a research illustration, not executable in this
                release: there is no on-chain Fuel product to buy.
              </p>
            ) : view.best.product === "excess" ? (
              <p className={s.muted}>Research result, not a purchase instruction. Buying is not available in this release.</p>
            ) : null}
          </>
        )}
      </div>

      {view.status === "ok" ? (
        <>
          <div className={s.headline}>
            <div className={s.figure}>
              <span className={s.muted}>Remaining shortfall, {view.showcaseWindow} historical showcase</span>
              <span className={s.figureValue}>{usd(view.showcase.shortfall)}</span>
            </div>
            <div className={s.figure}>
              <span className={s.muted}>Same period with cash only</span>
              <span className={s.figureValue}>{usd(view.showcase.cash_baseline_shortfall)}</span>
            </div>
          </div>
          <div className={s.headline}>
            <div className={s.figure}>
              <span className={s.muted}>Worst-5% average shortfall (historical)</span>
              <span className={s.quote}>{usd(view.best.tail_loss_95)}</span>
              <span className={s.muted}>{view.tailNote}</span>
            </div>
            <div className={s.figure}>
              <span className={s.muted}>Expected end-of-period cash</span>
              <span className={s.quote}>{usd(view.best.expected_end_cash)}</span>
              <span className={s.muted}>Average of remaining cash plus payout across windows; premiums spent in calm periods lower it.</span>
            </div>
          </div>
          <p className={s.muted}>
            Based on {view.windows} overlapping historical windows, not independent future trials. A payout cap can leave part of a
            bill uncovered.
          </p>

          {view.cashWins && view.zeroExposure ? null : (
            <GlowLineChart
              variant="comparison"
              title={view.chart.title}
              summary={view.chart.summary}
              series={view.chart.series}
              threshold={view.chart.threshold}
              formatAxisValue={(v) => usd(v, 0)}
              height={220}
            />
          )}

          <details className={s.disclosure}>
            <summary>See all comparisons</summary>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <caption className={s.muted}>All 21 allocations, ranked by historical worst-5% average shortfall (illustrative USD)</caption>
                <thead>
                  <tr>
                    <th scope="col">Choice</th>
                    <th scope="col">Allocation</th>
                    <th scope="col">Worst-5% average shortfall</th>
                    <th scope="col">Mean shortfall</th>
                    <th scope="col">Max shortfall</th>
                    <th scope="col">Cap reached</th>
                    <th scope="col">Expected end cash</th>
                  </tr>
                </thead>
                <tbody>
                  {view.ranked.map((r) => (
                    <tr key={`${r.product}-${r.stake}`} className={r === view.best ? s.best : undefined}>
                      <td>{PLANNER_NAME[r.product]}{r === view.best ? " (recommended)" : ""}</td>
                      <td>{usd(r.stake)}</td>
                      <td>{usd(r.tail_loss_95)}</td>
                      <td>{usd(r.mean_shortfall)}</td>
                      <td>{usd(r.max_shortfall)}</td>
                      <td>{capBindingText(r)}</td>
                      <td>{usd(r.expected_end_cash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className={s.muted}>
              {METHODOLOGY.map((m) => (
                <li key={m}>{m}</li>
              ))}
              <li>{art.scenario_note}</li>
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );
}
