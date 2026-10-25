"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { CPI_YOY, THRESHOLD } from "../lib/demoData";

const LEFT = 42;
const TOP = 20;

/** Recorded CPI samples only. Unobserved months never receive an invented line. */
export default function InflationTimeline({
  compact = false,
  observed = CPI_YOY.length,
}: {
  compact?: boolean;
  observed?: number;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const measure = () =>
      setWidth(
        Math.max(250, Math.round(element.getBoundingClientRect().width)),
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const WIDTH = width;
  const HEIGHT = compact ? 230 : 285;
  const RIGHT = WIDTH - 18;
  const BOTTOM = HEIGHT - 36;
  const xOf = (index: number) =>
    LEFT + (index / (CPI_YOY.length - 1)) * (RIGHT - LEFT);
  const yOf = (value: number) => BOTTOM - (value / 10) * (BOTTOM - TOP);
  const count = Math.min(
    CPI_YOY.length,
    Math.max(0, Number.isFinite(observed) ? Math.floor(observed) : 0),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const activeIndex = count ? Math.min(selected ?? count - 1, count - 1) : 0;
  const active = count ? CPI_YOY[activeIndex] : null;
  const values = CPI_YOY.slice(0, count);
  const line = values
    .map(
      (row, index) =>
        `${index === 0 ? "M" : "L"}${xOf(index).toFixed(2)},${yOf(row.value).toFixed(2)}`,
    )
    .join(" ");
  const area = count
    ? `${line} L${xOf(count - 1)},${BOTTOM} L${LEFT},${BOTTOM} Z`
    : "";
  const bubbleX = Math.min(RIGHT - 72, Math.max(LEFT + 72, xOf(activeIndex)));

  function inspect(event: PointerEvent<SVGSVGElement>) {
    if (!count) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const plotX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    setSelected(
      Math.min(
        count - 1,
        Math.max(
          0,
          Math.round(((plotX - LEFT) / (RIGHT - LEFT)) * (CPI_YOY.length - 1)),
        ),
      ),
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mp-section-label">US inflation · year on year</p>
          <div className="mt-2 flex items-baseline gap-3">
            <p
              key={active?.period ?? "empty"}
              className={`${compact ? "text-3xl" : "text-4xl"} mp-metric-value tick-in`}
            >
              {active ? `${active.value.toFixed(2)}%` : "—"}
            </p>
            <p className="text-xs text-muted">
              {active?.period ?? "No recorded readings yet"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[11px] font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          Historical CPI
        </div>
      </div>
      <div ref={plotRef} className="mt-4 w-full" style={{ height: HEIGHT }}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`timeline-title-${id} timeline-desc-${id}`}
          onPointerMove={inspect}
          onPointerLeave={() => setSelected(null)}
          className="h-full w-full touch-pan-y"
        >
          <title id={`timeline-title-${id}`}>
            US inflation from January 2021 to December 2024
          </title>
          <desc id={`timeline-desc-${id}`}>
            {count} recorded monthly readings. The dashed reference line is{" "}
            {THRESHOLD}%. Use the month selector below to inspect exact values.{" "}
            {active
              ? `${active.period}: ${active.value.toFixed(4)}%.`
              : "There are no recorded values yet."}
          </desc>
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff6b2b" stopOpacity=".08" />
              <stop offset="100%" stopColor="#ff6b2b" stopOpacity="0" />
            </linearGradient>
            <filter
              id={`glow-${id}`}
              x="-10%"
              y="-30%"
              width="120%"
              height="160%"
            >
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          {[0, 4, 8].map((v) => (
            <text
              key={v}
              x={LEFT - 13}
              y={yOf(v) + 4}
              textAnchor="end"
              fill="#64717b"
              fontSize="12"
            >
              {v}%
            </text>
          ))}
          <line
            x1={LEFT}
            x2={RIGHT}
            y1={yOf(THRESHOLD)}
            y2={yOf(THRESHOLD)}
            stroke="#aab4bd"
            strokeDasharray="4 6"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={RIGHT - 3}
            y={yOf(THRESHOLD) - 8}
            textAnchor="end"
            fill="#697781"
            fontSize="11"
          >
            4% threshold
          </text>
          {count ? (
            <>
              <path d={area} fill={`url(#fill-${id})`} />
              <path
                d={line}
                fill="none"
                stroke="#ff6b2b"
                strokeWidth="2"
                opacity=".32"
                filter={`url(#glow-${id})`}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={line}
                pathLength="1"
                className="draw-path"
                fill="none"
                stroke="#ff6b2b"
                strokeWidth="1.7"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {active ? (
                <g>
                  <line
                    x1={xOf(activeIndex)}
                    x2={xOf(activeIndex)}
                    y1={TOP}
                    y2={BOTTOM}
                    stroke="#d9dfe5"
                    strokeDasharray="3 5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={xOf(activeIndex)}
                    cy={yOf(active.value)}
                    r="7"
                    fill="#ff6b2b"
                    opacity=".12"
                  />
                  <circle
                    cx={xOf(activeIndex)}
                    cy={yOf(active.value)}
                    r="3.4"
                    fill="#ff6b2b"
                    stroke="#fff"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  {selected !== null ? (
                    <g
                      transform={`translate(${bubbleX - 64},${Math.max(TOP, yOf(active.value) - 50)})`}
                    >
                      <rect width="128" height="35" rx="8" fill="#172027" />
                      <text
                        x="64"
                        y="22"
                        textAnchor="middle"
                        fill="#fff"
                        fontSize="12"
                        fontWeight="600"
                      >
                        {active.period} · {active.value.toFixed(2)}%
                      </text>
                    </g>
                  ) : null}
                </g>
              ) : null}
            </>
          ) : null}
          {(width < 480 ? [0, 24, 47] : [0, 12, 24, 36, 47]).map((index) => (
            <text
              key={index}
              x={xOf(index)}
              y={HEIGHT - 8}
              textAnchor={
                index === 0 ? "start" : index === 47 ? "end" : "middle"
              }
              fill="#64717b"
              fontSize="12"
            >
              {index === 47 ? "Dec 2024" : String(2021 + index / 12)}
            </text>
          ))}
        </svg>
      </div>
      {count ? (
        <div className="mt-1 flex min-h-9 items-center gap-4">
          <span className="shrink-0 text-[11px] text-muted">Jan 2021</span>
          <input
            className="mp-chart-slider"
            type="range"
            min="0"
            max={count - 1}
            step="1"
            value={activeIndex}
            aria-label="Inspect monthly inflation reading"
            aria-valuetext={
              active
                ? `${active.period}, ${active.value.toFixed(4)} percent`
                : "No reading"
            }
            onChange={(event) => setSelected(Number(event.target.value))}
          />
          <span className="shrink-0 text-[11px] text-muted">
            {CPI_YOY[count - 1].period}
          </span>
        </div>
      ) : (
        <p className="py-3 text-xs text-muted">
          The recorded path will appear as monthly readings arrive.
        </p>
      )}
      {!compact ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          BLS / FRED CPIAUCNS · historical case study. The path joins recorded
          monthly readings; the score uses the exact monthly formula.
        </p>
      ) : null}
    </div>
  );
}
