"use client";

import {
  CPI_YOY,
  REFERENCE_POTS,
  amountsThrough,
  illustrativePayout,
  pathStats,
  potsThrough,
  scoresFrom,
  type PracticeEntry,
} from "../lib/demoData";
import { Card, Tag, fmt } from "./ui";

const SIDE_LABELS = [
  "Cooling · More",
  "Cooling · Less",
  "Excess · More",
  "Excess · Less",
] as const;

export default function MonthDecisionPanel({
  entries,
  monthIndex,
  setMonthIndex,
  deposited,
}: {
  entries: PracticeEntry[];
  monthIndex: number;
  setMonthIndex: (index: number) => void;
  deposited: boolean;
}) {
  const month = CPI_YOY[monthIndex];
  const added = amountsThrough(entries, monthIndex);
  const pots = potsThrough(entries, monthIndex);
  const maxPot = Math.max(...pots, 1);
  const visibleEntries = entries.filter(
    (entry) => entry.monthIndex <= monthIndex,
  );
  const scores = scoresFrom(
    pathStats(CPI_YOY.slice(0, monthIndex + 1).map((row) => row.value)),
  );
  const provisional = visibleEntries.length
    ? illustrativePayout(added, scores)
    : null;
  const points = CPI_YOY.slice(0, monthIndex + 1)
    .map(
      (row, index) =>
        String(8 + (index / 47) * 464) +
        "," +
        String(82 - (row.value / 10) * 68),
    )
    .join(" ");

  return (
    <Card order={0}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Tag tone="forecast">Monthly decision</Tag>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Pick a month. Read the pot.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Inspect the recorded inflation path and the pool before adding
            decisions. Add the same side more than once, or choose different
            sides within the same month.
          </p>
        </div>
        <label
          htmlFor="decision-month"
          className="min-w-52 text-xs font-semibold"
        >
          Decision month
          <select
            id="decision-month"
            value={monthIndex}
            disabled={deposited}
            onChange={(event) => setMonthIndex(Number(event.target.value))}
            className="mt-2 block h-11 w-full rounded-xl border border-line bg-panel-2 px-3 text-sm font-medium text-text"
          >
            {CPI_YOY.map((row, index) => (
              <option key={row.period} value={index}>
                {row.period}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 grid gap-5 border-t border-line pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="rounded-2xl bg-panel-2 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Recorded CPI · {month.period}
          </p>
          <p className="num mt-2 text-4xl font-semibold text-brand">
            {month.value.toFixed(2)}%
          </p>
          <svg
            viewBox="0 0 480 90"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="mt-5 h-20 w-full"
          >
            <line
              x1="8"
              x2="472"
              y1="54.8"
              y2="54.8"
              stroke="#aab4be"
              strokeDasharray="4 5"
            />
            <polyline
              points={points}
              fill="none"
              stroke="#e85b23"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="mt-3 text-xs leading-5 text-muted">
            Score through this month: Cooling{" "}
            {(scores.cooling * 100).toFixed(1)}%{" · "}Excess{" "}
            {(scores.excess * 100).toFixed(1)}%.
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            {provisional === null
              ? "Add an entry to see a provisional result for this point in the path."
              : "If this local scenario settled here: " +
                fmt(provisional) +
                " PLAY for entries added so far."}
          </p>
        </div>
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold">Pool by side</h3>
              <p className="mt-1 text-xs text-muted">
                Recorded 380 PLAY reference pool + your local entries through{" "}
                {month.period}
              </p>
            </div>
            <p className="num text-lg font-semibold">
              {fmt(pots.reduce((sum, value) => sum + value, 0))} PLAY
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {pots.map((pot, side) => (
              <div
                key={SIDE_LABELS[side]}
                className="rounded-xl border border-line bg-panel-2 p-4"
              >
                <div className="flex justify-between gap-2 text-xs">
                  <span className="font-semibold">{SIDE_LABELS[side]}</span>
                  <span className="num">{fmt(pot)} PLAY</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: String((pot / maxPot) * 100) + "%" }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  {fmt(REFERENCE_POTS[side])} recorded
                  {added[side] ? " + " + fmt(added[side]) + " practice" : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        The reference pool was funded before the replay and does not change by
        month. The changing amounts above are your local scenario entries, not
        devnet deposits. Final settlement still uses the full Jan 2021–Dec 2024
        path.
      </p>
    </Card>
  );
}
