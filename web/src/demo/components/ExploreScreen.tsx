"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
} from "recharts";
import { Card, Tag, InfoTip, fmt } from "./ui";
import { THRESHOLD, ordinal, type Amounts } from "../lib/demoData";
import {
  HIST_X,
  WINDOW,
  LAST_START,
  LIVE_START,
  EPISODES,
  indexOf,
  periodOf,
  rank2021,
  windowResult,
  windowPayout,
} from "../lib/cpiHistory";

const yearPos = (i: number) => {
  const p = periodOf(i);
  return p.year + (p.month - 1) / 12;
};
const MORE: Amounts = [10, 0, 10, 0];
const LESS: Amounts = [0, 10, 0, 10];
const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid #e6e5e1",
  borderRadius: 12,
  color: "#141414",
};
const DECADES = Array.from({ length: 12 }, (_, k) => 1920 + k * 10);

export default function ExploreScreen() {
  const [start, setStart] = useState(LIVE_START);

  // Long-run series, 1914 → latest.
  const longRun = useMemo(
    () =>
      HIST_X.map((x, i) => ({
        t: yearPos(i),
        label: periodOf(i).label,
        value: x / 10000,
      })),
    [],
  );
  const rank = useMemo(() => rank2021(), []);

  const w = windowResult(start);
  const first = periodOf(start);
  const last = periodOf(start + WINDOW - 1);
  const datasetEnd = periodOf(HIST_X.length - 1);
  const isLive = start === LIVE_START;
  const windowRows = HIST_X.slice(start, start + WINDOW).map((x, i) => ({
    label: periodOf(start + i).label,
    value: x / 10000,
    peak: w.stats.peaks[i],
  }));
  const more = windowPayout(start, MORE);
  const less = windowPayout(start, LESS);

  const years = Array.from(
    { length: periodOf(LAST_START).year - 1914 + 1 },
    (_, k) => 1914 + k,
  );
  const setYM = (y: number, m: number) =>
    setStart(Math.min(LAST_START, Math.max(0, indexOf(y, m))));

  return (
    <div className="space-y-6">
      <div className="reveal">
        <h1 className="text-4xl font-semibold tracking-tight">
          Explore inflation through history
        </h1>
        <p className="mt-2 max-w-3xl text-muted">
          {HIST_X.length.toLocaleString("en-GB")} months of US inflation, scored
          by the same rule. See how unusual 2021–24 was.
        </p>
        <p className="mt-3 text-sm font-medium text-brand">
          Transparency, not a recommendation.
        </p>
        <p className="mt-1 text-xs text-muted">
          Historical case studies through {datasetEnd.label}. These comparisons
          do not predict future results.
        </p>
      </div>

      {/* 1. The long run */}
      <Card order={1}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              US inflation, Jan 1914 – {datasetEnd.label}
            </h2>
            <p className="text-sm text-muted">
              Click anywhere on the line to replay the 4 years that start there.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm bg-accent/25" />{" "}
              The 2021–24 replay
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm bg-night/10" />{" "}
              Your selection
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-down" />{" "}
              4%
            </span>
          </div>
        </div>
        <div className="mt-4 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              accessibilityLayer
              data={longRun}
              margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
              onClick={(e) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const t = Number((e as any)?.activeLabel);
                if (!Number.isFinite(t)) return;
                const y = Math.floor(t);
                const m = Math.round((t - y) * 12) + 1;
                setYM(y, m);
              }}
              style={{ cursor: "pointer" }}
            >
              <defs>
                <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef6a22" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#ef6a22" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                domain={[1914, yearPos(HIST_X.length - 1)]}
                ticks={DECADES}
                tick={{ fill: "#66666d", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[-15, 25]}
                ticks={[-10, 0, 10, 20]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: "#66666d", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <ReferenceArea
                x1={yearPos(start)}
                x2={yearPos(start + WINDOW - 1)}
                fill="#141414"
                fillOpacity={0.07}
              />
              <ReferenceArea
                x1={2021}
                x2={2025}
                fill="#ef6a22"
                fillOpacity={0.18}
              />
              <ReferenceLine
                y={THRESHOLD}
                stroke="#d93d42"
                strokeDasharray="5 5"
              />
              <ReferenceLine y={0} stroke="#141414" strokeOpacity={0.25} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(_, p) =>
                  (p?.[0]?.payload?.label as string) ?? ""
                }
                formatter={(v) => [
                  typeof v === "number" ? `${v.toFixed(2)}%` : "—",
                  "Inflation",
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="none"
                fill="url(#histFill)"
                isAnimationActive={false}
                tooltipType="none"
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#ef6a22"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                name="Inflation"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 2. How unusual was 2021–24? */}
      <div className="grid gap-4 md:grid-cols-2">
        {[
          {
            name: "Inflation Cooling",
            what: "the fall from the 9.06% peak",
            pct: rank.cooling,
          },
          {
            name: "Excess Inflation",
            what: "the time and size above 4%",
            pct: rank.excess,
          },
        ].map((r, i) => (
          <Card key={r.name} order={2 + i}>
            <p className="flex items-center text-sm text-muted">
              {r.name}: how unusual was 2021–24?
              <InfoTip
                text={`Compared with all ${rank.windows} four-year windows that started in 1960 or later and ended by Dec 2020.`}
              />
            </p>
            <p className="num mt-2 text-4xl font-semibold text-brand">
              {ordinal(Math.round(r.pct * 100))}
            </p>
            <p className="text-sm text-muted">percentile, for {r.what}</p>
            <div className="mt-3 h-2 rounded-full bg-panel-2" aria-hidden>
              <div
                className="grow-bar h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                style={{ width: `${r.pct * 100}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              At or above {Math.round(r.pct * 100)}% of {rank.windows} four-year
              windows starting in 1960 or later and ending by Dec 2020.
            </p>
          </Card>
        ))}
      </div>

      {/* 3. Famous periods compared: same rule, side by side */}
      <Card order={4}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center text-lg font-semibold">
              Famous periods, scored by the same rule
              <InfoTip
                text="Each period is 48 months. Scores run from 0% to 100%."
                label="About these scores"
              />
            </h2>
            <p className="text-sm text-muted">
              Click a period to replay it below.
            </p>
          </div>
          <div className="flex gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 rounded-full bg-accent" />{" "}
              Cooling
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 rounded-full bg-night" />{" "}
              Excess
            </span>
          </div>
        </div>
        <ul className="mt-5 space-y-3">
          {EPISODES.map((e) => {
            const r = windowResult(e.start);
            return (
              <li key={e.key}>
                <button
                  type="button"
                  onClick={() => setStart(e.start)}
                  aria-pressed={start === e.start}
                  className={`grid w-full grid-cols-[9rem_minmax(0,1fr)] items-center gap-4 rounded-xl px-2 py-1.5 text-left transition hover:bg-panel-2 sm:grid-cols-[12rem_minmax(0,1fr)] ${
                    start === e.start ? "bg-panel-2" : ""
                  }`}
                >
                  <span>
                    <span
                      className={`block text-sm font-medium ${e.live ? "text-brand" : ""}`}
                    >
                      {e.label}
                    </span>
                    <span className="block text-xs text-muted">{e.years}</span>
                  </span>
                  <span className="space-y-1.5">
                    {[
                      { v: r.scores.cooling, c: "bg-accent", n: "Cooling" },
                      { v: r.scores.excess, c: "bg-night", n: "Excess" },
                    ].map((b) => (
                      <span key={b.n} className="flex items-center gap-2">
                        <span
                          className="h-2 flex-1 rounded-full bg-panel-2"
                          aria-hidden
                        >
                          <span
                            className={`grow-bar block h-full rounded-full ${b.c}`}
                            style={{ width: `${Math.max(2, b.v * 100)}%` }}
                          />
                        </span>
                        <span className="num w-12 text-right text-xs">
                          {Math.round(b.v * 100)}%
                        </span>
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Different paths produce different cooling and excess scores, even when
          their final readings look similar.
        </p>
      </Card>

      {/* 4. Replay any 4 years */}
      <Card order={5}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Replay any 4 years</h2>
            <p className="text-sm text-muted">
              Pick a famous period or any start month. Same rule, same pools.
            </p>
          </div>
          {isLive ? (
            <Tag tone="accent">Demo case study</Tag>
          ) : (
            <Tag>Historical comparison</Tag>
          )}
        </div>

        <div
          className="mt-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Famous periods"
        >
          {EPISODES.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => setStart(e.start)}
              aria-pressed={start === e.start}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                start === e.start
                  ? "border-accent bg-accent/10 text-brand"
                  : "border-line hover:border-text/30"
              }`}
            >
              {e.label} <span className="text-muted">{e.years}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">or start in</span>
          <select
            aria-label="Start month"
            value={first.month}
            onChange={(e) => setYM(first.year, Number(e.target.value))}
            className="rounded-full border border-line bg-panel px-3 py-1.5"
          >
            {[
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ].map((m, k) => (
              <option key={m} value={k + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            aria-label="Start year"
            value={first.year}
            onChange={(e) => setYM(Number(e.target.value), first.month)}
            className="rounded-full border border-line bg-panel px-3 py-1.5"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <span className="text-muted">
            → {first.label} to {last.label}
          </span>
        </div>

        <p className="mt-3 text-sm">
          {EPISODES.find((e) => e.start === start)?.story ?? ""}
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-5">
          <div className="h-64 lg:col-span-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                accessibilityLayer
                key={start}
                data={windowRows}
                margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
              >
                <defs>
                  <filter
                    id="winGlow"
                    x="-20%"
                    y="-50%"
                    width="140%"
                    height="200%"
                  >
                    <feGaussianBlur stdDeviation="3" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <XAxis
                  dataKey="label"
                  interval={11}
                  tick={{ fill: "#66666d", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fill: "#66666d", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <ReferenceLine
                  y={THRESHOLD}
                  stroke="#d93d42"
                  strokeDasharray="5 5"
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, n) => [
                    typeof v === "number" ? `${v.toFixed(2)}%` : "—",
                    n === "peak" ? "Highest so far" : "Inflation",
                  ]}
                />
                <Line
                  type="stepAfter"
                  dataKey="peak"
                  stroke="#141414"
                  strokeOpacity={0.3}
                  strokeWidth={1.4}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#ef6a22"
                  strokeWidth={1.5}
                  dot={false}
                  filter="url(#winGlow)"
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-3 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-panel-2 p-3">
                <p className="text-xs text-muted">Cooling score</p>
                <p className="num text-2xl font-semibold text-brand">
                  {(w.scores.cooling * 100).toFixed(2)}%
                </p>
                <p className="text-xs text-muted">
                  fell {w.stats.largestDecline.toFixed(2)} pts from{" "}
                  {w.stats.peak.toFixed(2)}%
                </p>
              </div>
              <div className="rounded-2xl bg-panel-2 p-3">
                <p className="text-xs text-muted">Excess score</p>
                <p className="num text-2xl font-semibold text-brand">
                  {(w.scores.excess * 100).toFixed(2)}%
                </p>
                <p className="text-xs text-muted">
                  {w.stats.accumulatedExcess.toFixed(1)} point-months above 4%
                  <br />
                  over {w.stats.monthsAbove} months
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-line p-3">
              <p className="text-xs text-muted">
                Illustrative payout on 10 + 10 PLAY, using the demo pools
              </p>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-sm">More + More</span>
                <span
                  className={`num font-semibold ${more >= 20 ? "text-up" : "text-down"}`}
                >
                  {fmt(more)} PLAY
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm">Less + Less</span>
                <span
                  className={`num font-semibold ${less >= 20 ? "text-up" : "text-down"}`}
                >
                  {fmt(less)} PLAY
                </span>
              </div>
            </div>
            <p className="text-xs text-muted">
              {isLive
                ? "The demo walkthrough uses this historical case study."
                : "A historical comparison only. The demo walkthrough uses 2021–24."}
            </p>
          </div>
        </div>
      </Card>

      <details className="rounded-2xl border border-line bg-panel p-5 text-sm">
        <summary className="cursor-pointer font-medium">
          Monthly readings for the selected window
        </summary>
        <p className="mt-2 text-xs text-muted">
          Year-on-year inflation. Exact recorded samples; the drawn curve is a
          visual guide.
        </p>
        <ul className="mt-4 grid max-h-64 gap-x-6 gap-y-2 overflow-y-auto sm:grid-cols-2">
          {windowRows.map((row) => (
            <li
              key={row.label}
              className="flex justify-between gap-4 border-b border-line py-2"
            >
              <span>{row.label}</span>
              <span className="num">{row.value.toFixed(4)}%</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted">
        Source: US CPI (BLS, FRED CPIAUCNS), Jan 1914 –{" "}
        {periodOf(HIST_X.length - 1).label}. The 2021–24 values match the replay
        exactly.
      </p>
    </div>
  );
}
