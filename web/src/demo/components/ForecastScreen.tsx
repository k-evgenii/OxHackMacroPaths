"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { catalogQuery, researchBundleQuery } from "@/lib/queries";
import referenceSession from "@macropaths/client/fixtures/session-B89z.view.json";
import type { ResearchBundle } from "@macropaths/client/types";
import { AnimatedNumber, Button, Card, Tag } from "./ui";
import {
  forecastGeometry,
  observedLabel,
  scoreBand,
  type ForecastProduct,
} from "../lib/forecast-model";

const PRODUCTS = {
  cooling: {
    title: "Inflation Cooling",
    color: "#087c60",
    description: "How far inflation falls from its earlier peak.",
    units: "percentage points",
  },
  excess: {
    title: "Excess Inflation",
    color: "#6351ce",
    description: "The accumulated inflation above 4% over time.",
    units: "point-months",
  },
  fuel: {
    title: "Fuel Pass-through",
    color: "#b53c0b",
    description: "The accumulated fuel cost above $3.50 per gallon.",
    units: "$·months per gallon",
  },
} as const;

function ForecastContent({ bundle }: { bundle: ResearchBundle }) {
  const [product, setProduct] = useState<ForecastProduct>("cooling");
  const [month, setMonth] = useState(0);
  const gradientId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(820);
  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const update = () => setChartWidth(Math.max(220, node.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { forecast, manifest } = bundle;
  const rows = forecast.rows;
  const row = rows[Math.min(month, rows.length - 1)];
  const end = rows.at(-1)!;
  const selected = PRODUCTS[product];
  const cell = row[product];
  const band = scoreBand(cell);
  const geometry = forecastGeometry(rows, product, chartWidth);
  const period = observedLabel(row.t, manifest.showcase.window[0]);
  const terminal = row.t === end.t;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <Tag tone="forecast">Forecast research</Tag>
            <Tag>2021–2024 case study</Tag>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Watch the outlook evolve.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Explore how an inflation model’s expected final product scores
            changed as each month arrived. Move through the historical period to
            see what changed.
          </p>
        </div>
        <div className="text-sm text-muted">
          <strong className="num text-lg font-semibold text-text">
            {forecast.n_paths.toLocaleString("en-GB")}
          </strong>{" "}
          simulated paths per step
        </div>
      </header>

      <Card order={0}>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {selected.title} ·{" "}
              {terminal ? "Realised research score" : "Expected final score"}
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <span
                className="num text-5xl font-semibold tracking-tight"
                style={{ color: selected.color }}
              >
                <AnimatedNumber value={cell.V * 100} decimals={1} />%
              </span>
              <span className="text-sm text-muted">{period}</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {terminal
                ? "The full historical path is now observed."
                : `Model spread: ${(band.lower * 100).toFixed(1)}–${(band.upper * 100).toFixed(1)}% (±1 standard deviation)`}
            </p>
          </div>
          <div
            className="flex max-w-full flex-wrap gap-1 rounded-xl bg-panel-2 p-1"
            aria-label="Forecast product"
          >
            {(Object.keys(PRODUCTS) as ForecastProduct[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={product === key}
                onClick={() => setProduct(key)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${product === key ? "bg-white text-text shadow-sm" : "text-muted hover:text-text"}`}
              >
                {key === "cooling"
                  ? "Cooling"
                  : key === "excess"
                    ? "Excess inflation"
                    : "Fuel research"}
              </button>
            ))}
          </div>
        </div>

        <div ref={chartRef} className="mt-6 overflow-hidden" aria-hidden="true">
          <svg
            viewBox={`0 0 ${chartWidth} 292`}
            className="h-[292px] w-full"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={selected.color}
                  stopOpacity=".18"
                />
                <stop
                  offset="100%"
                  stopColor={selected.color}
                  stopOpacity=".035"
                />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((value) => (
              <g key={value}>
                <line
                  x1="45"
                  x2={geometry.x(end.t)}
                  y1={geometry.y(value)}
                  y2={geometry.y(value)}
                  stroke="#e2e7eb"
                  strokeDasharray="3 5"
                />
                <text
                  x="33"
                  y={geometry.y(value) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="#5e6872"
                >
                  {value * 100}%
                </text>
              </g>
            ))}
            <polygon points={geometry.band} fill={`url(#${gradientId})`} />
            <polyline
              points={geometry.line}
              fill="none"
              stroke={selected.color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={geometry.x(row.t)}
              x2={geometry.x(row.t)}
              y1="22"
              y2="252"
              stroke={selected.color}
              strokeDasharray="4 4"
              opacity=".65"
            />
            <circle
              cx={geometry.x(row.t)}
              cy={geometry.y(cell.V)}
              r="6"
              fill="white"
              stroke={selected.color}
              strokeWidth="3"
            />
            {[0, 12, 24, 36, 48]
              .filter((t) => t <= end.t)
              .map((t) => (
                <text
                  key={t}
                  x={geometry.x(t)}
                  y="280"
                  fontSize="11"
                  fill="#5e6872"
                  textAnchor={
                    t === 0 ? "start" : t === end.t ? "end" : "middle"
                  }
                >
                  {t === 0 ? "Start" : `${t} months`}
                </text>
              ))}
          </svg>
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
          <span>
            <span
              className="mr-1 inline-block h-0.5 w-4 align-middle"
              style={{ background: selected.color }}
            />
            {terminal ? "Realised research score" : "Expected final score"}
          </span>
          <span>Shaded area: simulated score spread, clipped to 0–100%</span>
        </div>

        <div className="mt-6 rounded-xl border border-line bg-panel-2 p-4">
          <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm">
            <label htmlFor={`${gradientId}-month`} className="font-semibold">
              Months observed
            </label>
            <output htmlFor={`${gradientId}-month`} className="num text-muted">
              {row.t} of {end.t} · {period}
            </output>
          </div>
          <input
            id={`${gradientId}-month`}
            type="range"
            min={0}
            max={rows.length - 1}
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            aria-valuetext={`${row.t} months observed, ${period}, ${terminal ? "realised research" : "expected final"} ${selected.title} score ${(cell.V * 100).toFixed(1)} percent`}
            className="h-6 w-full cursor-pointer accent-[var(--color-forecast)]"
          />
          <div className="mt-2 flex justify-between text-xs text-muted">
            <button
              type="button"
              onClick={() => setMonth(0)}
              className="underline underline-offset-4"
            >
              At the start
            </button>
            <button
              type="button"
              onClick={() => setMonth(rows.length - 1)}
              className="underline underline-offset-4"
            >
              Full period
            </button>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-muted">
          This is a retrospective model replay, not a current inflation
          forecast. Each point estimates the score at the end of December 2024
          using the observations available at that step. Scores measure a
          product’s outcome, not the probability of an event; the shaded area is
          not a confidence interval.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {(Object.keys(PRODUCTS) as ForecastProduct[]).map((key, index) => {
          const p = manifest.products.find((item) => item.key === key);
          if (!p) return null;
          const metric = PRODUCTS[key];
          return (
            <Card
              key={key}
              order={index + 1}
              className={product === key ? "ring-1 ring-forecast/30" : ""}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{metric.title}</h2>
                {key === "fuel" ? (
                  <Tag>Research</Tag>
                ) : (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: metric.color }}
                  />
                )}
              </div>
              <p className="mt-2 min-h-10 text-xs leading-5 text-muted">
                {metric.description}
              </p>
              <p
                className="num mt-5 text-3xl font-semibold"
                style={{ color: metric.color }}
              >
                <AnimatedNumber value={row[key].V * 100} decimals={1} />%
              </p>
              <p className="mt-1 text-xs text-muted">
                {terminal ? "Realised research score" : "Expected final score"}
              </p>
              <div className="mt-5 border-t border-line pt-4 text-xs leading-5 text-muted">
                <p>
                  Research cap{" "}
                  <strong className="num text-text">
                    {(p.cap / 10000).toLocaleString("en-GB", {
                      maximumFractionDigits: 4,
                    })}
                  </strong>{" "}
                  {metric.units}
                </p>
                <p className="mt-1">
                  {key === "fuel"
                    ? "Research only · no on-chain product"
                    : "Research terms differ from the reference session."}
                </p>
              </div>
            </Card>
          );
        })}
      </div>

      <details className="rounded-2xl border border-line bg-white p-5 text-sm">
        <summary className="cursor-pointer font-semibold">
          Model, data and settlement terms
        </summary>
        <div className="mt-5 grid gap-5 text-xs leading-6 text-muted md:grid-cols-2">
          <div>
            <h3 className="font-semibold text-text">
              A fixed model, a changing picture
            </h3>
            <p className="mt-1">
              CPI model fitted on {forecast.fit.cpi.fit_window.join(" to ")}.
              The model parameters stay fixed; each new observed month updates
              the remaining simulated path.{" "}
              {forecast.n_paths.toLocaleString("en-GB")} simulations per step
              {forecast.seed === undefined ? "" : `, seed ${forecast.seed}`}.
            </p>
            <p className="mt-2">{forecast.model}</p>
          </div>
          <div>
            <h3 className="font-semibold text-text">
              Research and settlement are separate
            </h3>
            <p className="mt-1">
              The research model uses historical calibration caps. The reference
              session uses {Number(referenceSession.terms.dCap) / 10000}{" "}
              percentage points for Cooling and{" "}
              {Number(referenceSession.terms.aCap) / 10000} point-months for
              Excess Inflation, producing different scores for the same path.
              Settlement uses the realised observations and the session’s own
              terms; model estimates do not change it.
            </p>
            <p className="mt-2">
              Fuel’s historical statistic is{" "}
              {(manifest.showcase.fuel.stat / 10000).toFixed(4)} $·months per
              gallon, capped at{" "}
              {(
                manifest.products.find((p) => p.key === "fuel")!.cap / 10000
              ).toFixed(4)}{" "}
              for its research score.
            </p>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-text">Published data</h3>
            <p className="mt-1">
              US BLS CPI via FRED · EIA regular gasoline via FRED
            </p>
            {Object.entries(manifest.snapshots ?? {}).map(
              ([name, snapshot]) => (
                <p key={name}>
                  {name}: retrieved {snapshot.retrieved_at.slice(0, 10)}
                </p>
              ),
            )}
            <p className="mt-2 break-all">Bundle {bundle.id}</p>
          </div>
          <div>
            <h3 className="font-semibold text-text">Read the source series</h3>
            <p className="mt-1">
              <a
                href="https://fred.stlouisfed.org/series/CPIAUCNS"
                target="_blank"
                rel="noreferrer"
                className="text-brand underline underline-offset-4"
              >
                US consumer price index ↗
              </a>
            </p>
            <p>
              <a
                href="https://fred.stlouisfed.org/series/GASREGW"
                target="_blank"
                rel="noreferrer"
                className="text-brand underline underline-offset-4"
              >
                US regular gasoline prices ↗
              </a>
            </p>
          </div>
        </div>
      </details>
      <details className="rounded-2xl border border-line bg-white p-5 text-sm">
        <summary className="cursor-pointer font-semibold">
          View chart values
        </summary>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="mb-3 text-left text-muted">
              {selected.title}: expected final score and simulated dispersion at
              each historical step.
            </caption>
            <thead>
              <tr className="border-b border-line">
                <th className="py-3 pr-4">Observed period</th>
                <th className="py-3 pr-4">Score</th>
                <th className="py-3">Standard deviation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.t} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4">
                    {observedLabel(item.t, manifest.showcase.window[0])}
                  </td>
                  <td className="num py-2 pr-4">
                    {(item[product].V * 100).toFixed(2)}%
                  </td>
                  <td className="num py-2">
                    {(item[product].sigma * 100).toFixed(2)} percentage points
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export default function ForecastScreen() {
  const catalog = useQuery(catalogQuery());
  const bundleId = catalog.data?.research?.bundleId;
  const bundle = useQuery({
    ...researchBundleQuery(bundleId ?? ""),
    enabled: !!bundleId,
  });
  const error = catalog.error || bundle.error;
  if (error || (catalog.isSuccess && !bundleId))
    return (
      <Card>
        <h1 className="text-2xl font-semibold">
          Forecast research is unavailable
        </h1>
        <p className="my-4 text-sm text-muted">
          The published model could not be loaded. Your saved positions are
          unaffected.
        </p>
        <Button
          onClick={() => {
            void catalog.refetch();
            if (bundleId) void bundle.refetch();
          }}
        >
          Try again
        </Button>
      </Card>
    );
  if (!bundle.data)
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Forecast</h1>
        <p role="status" className="mt-3 text-sm text-muted">
          Loading the published inflation model…
        </p>
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-panel-2" />
      </Card>
    );
  if (!bundle.data.forecast.rows.length)
    return (
      <Card>
        <h1 className="text-2xl font-semibold">
          No forecast observations available
        </h1>
      </Card>
    );
  return <ForecastContent key={bundle.data.id} bundle={bundle.data} />;
}
