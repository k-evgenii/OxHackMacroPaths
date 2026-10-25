"use client";

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cx } from "./primitives";

/* Measures the rendered width so SVG text stays at its real pixel size. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/* ---------------------------------------------------------------------------
 * Sparkline. Source: Capsule KPI cards and Market table rows (glowing mini line).
 * Decoration inside a stat tile, so it carries no hover layer of its own.
 * ------------------------------------------------------------------------- */
export function Sparkline({ values, tone = "path", label }: { values: number[]; tone?: "path" | "up" | "down"; label?: string }) {
  const w = 120;
  const h = 40;
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join("");
  const stroke = tone === "up" ? "var(--mp-up)" : tone === "down" ? "var(--mp-down)" : "var(--mp-path)";
  return (
    <svg className="mp-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} style={{ stroke, filter: "var(--mp-glow)" }} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * PathChart. Source: Capsule "Price" area chart (gradient fill, year ticks,
 * tooltip card, dashed crosshair) + BTC mobile (dotted reference line with its
 * value labelled) + AERIS Cashflow (vertical marker).
 * Backend: Session.values[0..48] (1e-4 pp), threshold = Session.k,
 * cursor = Session.next_index during replay. Months not yet observed are null
 * and draw as a dotted placeholder. The area above the threshold is shaded:
 * that area is the accumulated excess.
 * ------------------------------------------------------------------------- */
export interface PathPoint {
  label: string;          // tooltip date, e.g. "Mar 2022"
  value: number | null;   // already in display units, null = not observed yet
}

export interface PathChartProps {
  points: PathPoint[];
  threshold?: { value: number; label: string };
  cursorIndex?: number;
  markers?: Array<{ index: number; label: string }>;
  xTicks?: Array<{ index: number; label: string }>;
  formatValue?: (v: number) => string;
  height?: number;
  title: string;          // accessible name; the card title usually repeats it
  yDomain?: [number, number];
}

export function PathChart({ points, threshold, cursorIndex, markers = [], xTicks = [], formatValue = (v) => v.toFixed(2), height = 300, title, yDomain }: PathChartProps) {
  const uid = useId().replace(/:/g, "");
  const [wrapRef, width] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 16, right: 16, bottom: 28, left: 48 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = Math.max(10, height - pad.top - pad.bottom);

  const observed = points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const all = threshold ? [...observed, threshold.value] : observed;
  const lo = yDomain ? yDomain[0] : Math.min(0, ...all);
  const hi = yDomain ? yDomain[1] : Math.max(1, ...all) * 1.08;
  const ticks = niceTicks(lo, hi, 5);
  const yMin = Math.min(lo, ticks[0]);
  const yMax = Math.max(hi, ticks[ticks.length - 1]);

  const n = points.length;
  const x = (i: number) => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
  const baseY = y(Math.max(yMin, 0));

  let lastObserved = -1;
  points.forEach((p, i) => {
    if (p.value !== null) lastObserved = i;
  });
  const solid = points.slice(0, lastObserved + 1);
  const line = solid.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value ?? 0).toFixed(1)}`).join("");
  const area = solid.length > 1 ? `${line}L${x(solid.length - 1).toFixed(1)},${baseY.toFixed(1)}L${x(0).toFixed(1)},${baseY.toFixed(1)}Z` : "";
  const pending = lastObserved >= 0 && lastObserved < n - 1 ? `M${x(lastObserved)},${y(points[lastObserved].value ?? 0)}L${x(n - 1)},${y(points[lastObserved].value ?? 0)}` : "";
  const thY = threshold ? y(threshold.value) : null;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    const px = e.clientX - rect.left - pad.left;
    const i = Math.round((px / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="mp-chart" ref={wrapRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--mp-path)", stopOpacity: 0.14 }} />
            <stop offset="100%" style={{ stopColor: "var(--mp-path)", stopOpacity: 0 }} />
          </linearGradient>
          {thY !== null ? (
            <clipPath id={`c${uid}`}>
              <rect x={pad.left} y={pad.top} width={innerW} height={Math.max(0, thY - pad.top)} />
            </clipPath>
          ) : null}
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line className="mp-chart__grid" x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} />
            <text className="mp-chart__tick" x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {formatValue(t)}
            </text>
          </g>
        ))}
        <line className="mp-chart__axis" x1={pad.left} x2={pad.left + innerW} y1={baseY} y2={baseY} />
        {xTicks.map((t) => (
          <text key={t.index} className="mp-chart__tick" x={x(t.index)} y={height - 8} textAnchor="middle">
            {t.label}
          </text>
        ))}

        {area ? <path className="mp-chart__area" d={area} fill={`url(#g${uid})`} /> : null}
        {area && thY !== null ? <path className="mp-chart__area" d={area} style={{ fill: "var(--mp-path)", opacity: 0.4 }} clipPath={`url(#c${uid})`} /> : null}
        {pending ? <path className="mp-chart__pending" d={pending} /> : null}
        {line ? <path className="mp-chart__line" d={line} /> : null}

        {threshold && thY !== null ? (
          <g>
            <line className="mp-chart__threshold" x1={pad.left} x2={pad.left + innerW} y1={thY} y2={thY} />
            <text className="mp-chart__threshold-label" x={pad.left + innerW} y={thY - 6} textAnchor="end">
              {threshold.label}
            </text>
          </g>
        ) : null}

        {cursorIndex !== undefined && cursorIndex >= 0 && cursorIndex < n ? (
          <line className="mp-chart__cursor" x1={x(cursorIndex)} x2={x(cursorIndex)} y1={pad.top} y2={pad.top + innerH} />
        ) : null}

        {markers.map((m) => {
          const v = points[m.index]?.value;
          if (v === null || v === undefined) return null;
          return (
            <g key={`${m.index}-${m.label}`}>
              <circle className="mp-chart__dot" cx={x(m.index)} cy={y(v)} r={4.5} />
              <text className="mp-chart__threshold-label" x={x(m.index)} y={y(v) - 10} textAnchor="middle">
                {m.label}
              </text>
            </g>
          );
        })}

        {hp && hover !== null ? (
          <g>
            <line className="mp-chart__cursor" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} />
            {hp.value !== null ? <circle className="mp-chart__dot" cx={x(hover)} cy={y(hp.value)} r={4.5} /> : null}
          </g>
        ) : null}

        <rect
          className="mp-chart__hit"
          x={pad.left}
          y={pad.top}
          width={innerW}
          height={innerH}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hp && hover !== null ? (
        <div className="mp-chart__tooltip" style={{ left: x(hover), top: hp.value !== null ? y(hp.value) : pad.top + innerH / 2 }}>
          <strong className="mp-num">{hp.value !== null ? formatValue(hp.value) : "Not observed yet"}</strong>
          <span>{hp.label}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * BarChart. Source: bank app "Expenses" (value label above each bar, a cap
 * line on the bar top, a dashed average line with its value).
 * Backend: excess accrued per year, or the planner's TailLoss95 per stake.
 * ------------------------------------------------------------------------- */
export interface BarDatum {
  label: string;
  value: number;
  highlight?: boolean;
}

export function BarChart({ data, reference, formatValue = (v) => v.toFixed(2), height = 260, title }: { data: BarDatum[]; reference?: { value: number; label: string }; formatValue?: (v: number) => string; height?: number; title: string }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>(480);
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 28, right: 8, bottom: 28, left: 8 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = Math.max(10, height - pad.top - pad.bottom);
  const max = Math.max(...data.map((d) => d.value), reference?.value ?? 0) * 1.1 || 1;
  const slot = innerW / Math.max(1, data.length);
  const gap = 2;
  const barW = Math.max(4, slot - Math.max(gap, slot * 0.08));
  const y = (v: number) => pad.top + innerH - (Math.max(0, v) / max) * innerH;

  return (
    <div className="mp-chart" ref={wrapRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        {data.map((d, i) => {
          const bx = pad.left + i * slot + (slot - barW) / 2;
          const by = y(d.value);
          return (
            <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect className={cx("mp-chart__bar", d.highlight && "mp-chart__bar--highlight")} x={bx} y={by} width={barW} height={pad.top + innerH - by} rx={4} />
              <line className="mp-chart__bar-cap" x1={bx} x2={bx + barW} y1={by} y2={by} />
              <text className="mp-chart__bar-label" x={bx + 6} y={pad.top + innerH - by < 22 ? by - 6 : by + 16}>
                {formatValue(d.value)}
              </text>
              <text className="mp-chart__tick" x={bx + barW / 2} y={height - 8} textAnchor="middle">
                {d.label}
              </text>
              <rect className="mp-chart__hit" x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} />
            </g>
          );
        })}
        {reference ? (
          <g>
            <line className="mp-chart__threshold" x1={pad.left} x2={pad.left + innerW} y1={y(reference.value)} y2={y(reference.value)} />
            <text className="mp-chart__threshold-label" x={pad.left + innerW} y={y(reference.value) - 6} textAnchor="end">
              {reference.label}
            </text>
          </g>
        ) : null}
      </svg>
      {hover !== null ? (
        <div className="mp-chart__tooltip" style={{ left: pad.left + hover * slot + slot / 2, top: y(data[hover].value) }}>
          <strong className="mp-num">{formatValue(data[hover].value)}</strong>
          <span>{data[hover].label}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * MiniBars. Source: AERIS "Activity" (weekday bars, one highlighted in lime).
 * Backend: observations posted per year, or positions per side.
 * ------------------------------------------------------------------------- */
export function MiniBars({ data, label }: { data: BarDatum[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="mp-minibars" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
      {data.map((d) => (
        <div className="mp-minibars__col" key={d.label}>
          <div className={cx("mp-minibars__bar", d.highlight && "mp-minibars__bar--highlight")} style={{ height: `${(d.value / max) * 100}%` }} />
          <span className="mp-minibars__label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * CompositionBar + legend. Source: AERIS "Spend composition" and bank app
 * "Planned expenses" (stacked pill bar, dot legend with values).
 * Backend: Session.side_totals[4] = product × side deposits in PLAY.
 * Colours follow the entity in fixed order (series-1..4), never the rank.
 * ------------------------------------------------------------------------- */
export interface CompositionSegment {
  label: string;
  value: number;
}

const SERIES = ["var(--mp-series-1)", "var(--mp-series-2)", "var(--mp-series-3)", "var(--mp-series-4)"];

export function CompositionBar({ segments, formatValue = (v) => v.toLocaleString(), showPercent = true, title }: { segments: CompositionSegment[]; formatValue?: (v: number) => string; showPercent?: boolean; title: string }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div>
      <div className="mp-composition" role="img" aria-label={title}>
        {segments.map((s, i) =>
          s.value > 0 ? <div key={s.label} className="mp-composition__seg" style={{ flex: s.value, background: SERIES[i % SERIES.length] }} title={`${s.label}: ${formatValue(s.value)}`} /> : null,
        )}
      </div>
      <ul className="mp-legend" style={{ marginTop: 16 }}>
        {segments.map((s, i) => (
          <li key={s.label}>
            <span className="mp-legend__swatch" style={{ background: SERIES[i % SERIES.length] }} aria-hidden="true" />
            <span>{s.label}</span>
            <span className="mp-legend__value">
              {formatValue(s.value)}
              {showPercent && total > 0 ? <span className="mp-muted"> · {Math.round((s.value / total) * 100)}%</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Re-exported so cards can embed a chart legend row without a full chart. */
export function LegendRow({ items }: { items: Array<{ label: string; value?: ReactNode; colorIndex: number }> }) {
  return (
    <ul className="mp-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className="mp-legend__swatch" style={{ background: SERIES[it.colorIndex % SERIES.length] }} aria-hidden="true" />
          <span>{it.label}</span>
          <span className="mp-legend__value">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}
