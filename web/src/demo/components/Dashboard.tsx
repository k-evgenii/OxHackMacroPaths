"use client";
import { useMemo, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { AnimatedNumber, Card, Tag } from "./ui";
import InflationTimeline from "./InflationTimeline";
import Proof from "./Proof";
import { FINAL_SCORES } from "../lib/demoData";

const NewsPreview = dynamic(() => import("./NewsScreen"), {
  loading: () => (
    <div
      className="h-40 animate-pulse rounded-2xl bg-panel"
      role="status"
      aria-label="Loading news"
    />
  ),
});
const PRODUCTS = [
  {
    key: "cooling",
    title: "How far will inflation cool?",
    name: "Inflation Cooling",
    description:
      "The largest fall from an earlier peak, measured across the full period.",
    score: FINAL_SCORES.cooling,
    color: "#6f56e8",
    className: "mp-score-cooling",
    stat: "6.62",
    unit: "point fall",
    cap: "8-point cap",
    label: "More cooling",
    less: "Less cooling",
    index: 0,
  },
  {
    key: "excess",
    title: "How long will inflation run hot?",
    name: "Excess Inflation",
    description:
      "Every month above 4% contributes. Both the height and duration count.",
    score: FINAL_SCORES.excess,
    color: "#00b58c",
    className: "mp-score-excess",
    stat: "69.12",
    unit: "point-months",
    cap: "80 point-month cap",
    label: "More excess",
    less: "Less excess",
    index: 1,
  },
];
type Props = {
  balance: number;
  locked: number;
  runs: number;
  deposited: boolean;
  onStart: () => void;
  onSelect: (product: number, side: number) => void;
  onExplore: () => void;
  onNews: () => void;
  onWallet: () => void;
  query: string;
  onQuery: (q: string) => void;
};

export default function Dashboard(p: Props) {
  const [filter, setFilter] = useState("All paths");
  const products = useMemo(
    () =>
      PRODUCTS.filter(
        (item) =>
          (filter === "All paths" || filter === item.name) &&
          `${item.name} ${item.title} ${item.description}`
            .toLowerCase()
            .includes(p.query.toLowerCase().trim()),
      ),
    [filter, p.query],
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="mp-section-label">Economics / US inflation</span>
            <Tag tone="accent">Path contracts</Tag>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Follow inflation.{" "}
            <span className="text-muted">Through every turn.</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            One final number misses the story. Take a position on the path it
            takes to get there.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-xs">
          <span className="h-2 w-2 rounded-full bg-violet" aria-hidden />
          <span className="font-semibold">Jan 2021 — Dec 2024</span>
          <span className="text-muted">Case study</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2.15fr)_minmax(260px,1fr)]">
        <Card className="!p-5 sm:!p-6">
          <InflationTimeline compact />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-[11px] text-muted">
              48 monthly readings · CPI-U, year on year · BLS / FRED
            </p>
            <button
              type="button"
              onClick={p.onExplore}
              className="text-xs font-semibold text-brand"
            >
              Explore the full history ↗
            </button>
          </div>
        </Card>
        <section className="mp-card mp-soft-orbit flex flex-col p-6">
          <div className="flex items-center justify-between">
            <p className="mp-section-label">Your portfolio</p>
            <Tag>PLAY</Tag>
          </div>
          <p className="mt-5 text-xs text-muted">Available balance</p>
          <p className="mp-metric-value mt-1 text-4xl">
            <AnimatedNumber value={p.balance} />
          </p>
          <p className="mt-2 text-[11px] text-muted">
            Practice balance · Solana devnet
          </p>
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
            <div>
              <p className="text-xs text-muted">In position</p>
              <p className="mt-1 text-lg font-semibold">
                <AnimatedNumber value={p.locked} />{" "}
                <span className="text-[10px] font-normal text-muted">PLAY</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Settled previews</p>
              <p className="mp-metric-value mt-1 text-lg">{p.runs}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={p.onStart}
            className="mp-button mp-button-primary mt-6 w-full py-3 text-sm"
          >
            {p.deposited ? "Continue position →" : "Build a position →"}
          </button>
          <button
            type="button"
            onClick={p.onWallet}
            className="mt-3 py-1 text-xs font-medium text-muted hover:text-text"
          >
            View wallet & activity
          </button>
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Pick your path
            </h2>
            <p className="mt-1 text-xs text-muted">
              Two products. More or Less. One published settlement rule.
            </p>
          </div>
          <div className="relative w-full sm:w-60">
            <svg
              viewBox="0 0 20 20"
              className="absolute left-3 top-3 h-4 w-4 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="m13 13 4 4" />
            </svg>
            <input
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
              aria-label="Search inflation products"
              placeholder="Search inflation products"
              type="search"
              className="h-10 w-full rounded-xl border border-line bg-panel pl-9 pr-3 text-sm"
            />
          </div>
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Product category"
        >
          {["All paths", "Inflation Cooling", "Excess Inflation"].map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${filter === f ? "bg-night text-white" : "border border-line bg-panel text-muted hover:border-text/20"}`}
            >
              {f}
            </button>
          ))}
        </div>
        {!products.length ? (
          <Card>
            <p className="font-semibold">No products match that search.</p>
            <button
              type="button"
              onClick={() => {
                p.onQuery("");
                setFilter("All paths");
              }}
              className="mt-3 text-sm text-brand underline"
            >
              Clear filters
            </button>
          </Card>
        ) : (
          <div className="mp-stagger grid gap-4 md:grid-cols-2">
            {products.map((product) => (
              <article
                key={product.key}
                className="mp-market-card p-5 sm:p-6"
                style={{ "--mp-card-accent": product.color } as CSSProperties}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`grid h-9 w-9 place-items-center rounded-xl text-lg font-semibold ${product.className}`}
                      aria-hidden
                    >
                      {product.index ? "∑" : "↘"}
                    </span>
                    <div>
                      <p className="text-xs font-semibold">{product.name}</p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        US CPI · 48 monthly observations
                      </p>
                    </div>
                  </div>
                  <Tag>Historical result</Tag>
                </div>
                <h3 className="mt-5 text-xl font-semibold leading-snug tracking-tight">
                  {product.title}
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
                  {product.description}
                </p>
                <div className="mt-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="mp-section-label">Settled score</p>
                    <p
                      className={`mp-metric-value mt-1 text-3xl ${product.index ? "text-up" : "text-forecast"}`}
                    >
                      {(product.score * 100).toFixed(2)}
                      <span className="ml-0.5 text-xl">%</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {product.stat}{" "}
                      <span className="text-xs font-normal text-muted">
                        {product.unit}
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted">{product.cap}</p>
                  </div>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className="grow-bar h-full rounded-full"
                    style={{
                      width: `${product.score * 100}%`,
                      background: product.color,
                    }}
                  />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => p.onSelect(product.index, 0)}
                    className="mp-side-more min-h-11 rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:brightness-95"
                  >
                    {product.label} ↗
                  </button>
                  <button
                    type="button"
                    onClick={() => p.onSelect(product.index, 1)}
                    className="mp-side-less min-h-11 rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:brightness-95"
                  >
                    {product.less} ↘
                  </button>
                </div>
                <p className="mt-3 text-[10px] text-muted">
                  Scores measure the historical path, not the chance of a future
                  event.
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mp-card grid gap-5 overflow-hidden p-5 sm:p-6 md:grid-cols-[1.5fr_1fr] md:items-center">
        <div>
          <p className="mp-section-label">Look beyond the latest print</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            A short spike and a long squeeze aren’t the same.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Compare 112 years of inflation. See how peaks, cooling and time
            above a threshold change the score.
          </p>
        </div>
        <button
          type="button"
          onClick={p.onExplore}
          className="mp-button flex items-center justify-between gap-5 border border-line bg-panel-2 px-5 py-4 text-sm"
        >
          <span className="font-semibold">Explore historical periods</span>
          <span className="text-xl text-forecast" aria-hidden>
            ↗
          </span>
        </button>
      </section>
      <div>
        <NewsPreview compact />
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={p.onNews}
            className="text-sm font-semibold text-brand"
          >
            Open the inflation brief →
          </button>
        </div>
      </div>
      <Proof />
    </div>
  );
}
