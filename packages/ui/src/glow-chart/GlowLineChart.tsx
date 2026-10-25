"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { GlowLineChartProps } from "./types";
import {
  areaPath, clampBubble, estimateBubbleWidth, isObserved, makeScale, monotonePath, nearestPoint, segments,
  stepSelection, xDomain, yDomain, yTicks, type Located,
} from "./geometry";

export const GLOW_COLORS = {
  canvas: "#101722",
  primary: "#6F9FFF",
  secondary: "#C9B27C",
  label: "#A4B1C5",
  threshold: "#A4B1C5",
} as const;

const DEFAULT_HEIGHT = { hero: 300, comparison: 260, sparkline: 56 } as const;

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

/* Scoped chart-local CSS: draw-in on first mount only, disabled under reduced motion. */
const CSS = `
.mpg-chart{position:relative;background:${GLOW_COLORS.canvas};border-radius:14px;color:${GLOW_COLORS.label};outline:none;touch-action:pan-y}
.mpg-chart:focus-visible{box-shadow:0 0 0 2px ${GLOW_COLORS.primary}}
.mpg-chart svg{display:block;overflow:visible}
.mpg-chart .mpg-draw{stroke-dasharray:1;stroke-dashoffset:0;animation:mpg-draw .9s ease-out both}
@keyframes mpg-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.mpg-bubble{position:absolute;pointer-events:none;background:rgba(16,23,34,.94);border:1px solid rgba(111,159,255,.35);border-radius:8px;padding:6px 10px;font-size:12px;line-height:1.35;color:#E6ECF5;white-space:normal;overflow-wrap:anywhere;box-sizing:border-box}
.mpg-bubble b{display:block;font-weight:600;color:#fff}
.mpg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion: reduce){.mpg-chart .mpg-draw{animation:none}}
`;

export function GlowLineChart(props: GlowLineChartProps) {
  const {
    title, summary, series, threshold, xTicks = [], formatAxisValue, variant = "hero",
    selectedPointId, onSelectedPointChange, height, className,
  } = props;
  const isSpark = variant === "sparkline";
  const h = height ?? DEFAULT_HEIGHT[variant];
  const uid = "mpg" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [wrapRef, width] = useWidth<HTMLDivElement>(isSpark ? 160 : 720);
  const controlled = selectedPointId !== undefined;
  const [localSel, setLocalSel] = useState<string | null>(null);
  const selId = controlled ? selectedPointId ?? null : localSel;
  // Draw-in runs once on initial display, not on polling updates.
  const [animate] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 1000);
    return () => clearTimeout(t);
  }, []);

  const visible = (variant === "hero" ? series.slice(0, 1) : variant === "comparison" ? series.slice(0, 2) : series.slice(0, 1));

  const pad = isSpark ? { top: 4, right: 4, bottom: 4, left: 4 } : { top: 18, right: 16, bottom: 30, left: 52 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = Math.max(10, h - pad.top - pad.bottom);

  const geo = useMemo(() => {
    const yd = yDomain(visible, threshold);
    const xd = xDomain(visible, xTicks);
    const sx = makeScale(xd, [pad.left, pad.left + innerW]);
    const sy = makeScale(yd, [pad.top + innerH, pad.top]);
    const located: Located[] = [];
    const lines = visible.map((s, si) => {
      const segs = segments(s.points).map((seg) => seg.map((p) => ({ x: sx(p.x), y: sy(p.value as number) })));
      for (const p of s.points) if (isObserved(p)) located.push({ seriesId: s.id, point: p, px: sx(p.x), py: sy(p.value) });
      return { s, tone: s.tone ?? (si === 0 ? "primary" : "secondary"), segs };
    });
    located.sort((a, b) => a.px - b.px || a.py - b.py);
    return { yd, sx, sy, lines, located, ticks: yTicks(yd, 4) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, threshold, xTicks, innerW, innerH, isSpark]);

  const selected = selId === null ? null : geo.located.find((l) => l.point.id === selId) ?? null;
  const select = (id: string | null) => {
    if (!controlled) setLocalSel(id);
    onSelectedPointChange?.(id);
  };

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const hit = nearestPoint(geo.located, e.clientX - r.left, e.clientY - r.top);
    if (hit && hit.point.id !== selId) select(hit.point.id);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      select(null);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = stepSelection(geo.located, selId, e.key);
    if (next) select(next.point.id);
  };

  const thY = threshold ? geo.sy(threshold.value) : null;
  const thInside = thY !== null && thY >= pad.top && thY <= pad.top + innerH;
  const baseY = pad.top + innerH;
  const ids = { fill: `${uid}-fill`, glow: `${uid}-glow`, clip: `${uid}-clip`, plot: `${uid}-plot`, desc: `${uid}-desc`, list: `${uid}-list` };
  const seriesColor = (tone: string) => (tone === "secondary" ? GLOW_COLORS.secondary : GLOW_COLORS.primary);

  let bubble: { left: number; top: number; w: number; lines: string[] } | null = null;
  if (selected && !isSpark) {
    const s = visible.find((v) => v.id === selected.seriesId);
    const lines = [selected.point.formattedValue, selected.point.label, ...(visible.length > 1 && s ? [s.label] : [])];
    const w = Math.min(estimateBubbleWidth(lines), Math.max(80, width - 8));
    const left = clampBubble(selected.px, w, width);
    const top = Math.max(2, selected.py - 64);
    bubble = { left, top, w, lines };
  }

  const noData = geo.located.length === 0;
  const announce = selected ? `${selected.point.label}: ${selected.point.formattedValue}` : "";

  return (
    <div
      ref={wrapRef}
      className={["mpg-chart", `mpg-${variant}`, className].filter(Boolean).join(" ")}
      role="group"
      aria-roledescription="chart"
      aria-label={title}
      aria-describedby={ids.desc}
      tabIndex={isSpark || noData ? undefined : 0}
      onKeyDown={isSpark ? undefined : onKey}
      onBlur={undefined}
      data-variant={variant}
    >
      <style>{CSS}</style>
      <p id={ids.desc} className="mpg-sr">{summary}</p>
      <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GLOW_COLORS.primary} stopOpacity={0.08} />
            <stop offset="100%" stopColor={GLOW_COLORS.primary} stopOpacity={0} />
          </linearGradient>
          <filter id={ids.glow} x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation={2.5} />
          </filter>
          <clipPath id={ids.plot}>
            <rect x={pad.left - 2} y={pad.top - 2} width={innerW + 4} height={innerH + 4} />
          </clipPath>
          {thInside ? (
            <clipPath id={ids.clip}>
              <rect x={pad.left} y={pad.top - 2} width={innerW} height={Math.max(0, (thY as number) - pad.top + 2)} />
            </clipPath>
          ) : null}
        </defs>

        {!isSpark
          ? geo.ticks.map((t) => (
              <text key={t} x={pad.left - 8} y={geo.sy(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={GLOW_COLORS.label} opacity={0.75}>
                {formatAxisValue(t)}
              </text>
            ))
          : null}
        {!isSpark
          ? xTicks.map((t) => (
              <text key={`x${t.x}`} x={geo.sx(t.x)} y={h - 8} textAnchor="middle" fontSize={11} fill={GLOW_COLORS.label} opacity={0.75}>
                {t.label}
              </text>
            ))
          : null}

        <g clipPath={`url(#${ids.plot})`}>
          {geo.lines.map(({ s, tone, segs }) =>
            segs.map((pts, k) => (
              <g key={`${s.id}-${k}`} data-series={s.id}>
                {tone === "primary" && pts.length > 1 ? <path d={areaPath(pts, baseY)} fill={`url(#${ids.fill})`} data-role="area" /> : null}
                {tone === "primary" && thInside && pts.length > 1 ? (
                  <path d={areaPath(pts, thY as number)} fill={GLOW_COLORS.primary} fillOpacity={0.12} clipPath={`url(#${ids.clip})`} data-role="excess" />
                ) : null}
              </g>
            )),
          )}
          {thInside && threshold ? (
            <g data-role="threshold">
              <line x1={pad.left} x2={pad.left + innerW} y1={thY as number} y2={thY as number} stroke={GLOW_COLORS.threshold} strokeOpacity={0.6} strokeDasharray="4 4" strokeWidth={1} />
              {!isSpark ? (
                <text x={pad.left + innerW} y={(thY as number) - 6} textAnchor="end" fontSize={11} fill={GLOW_COLORS.label}>{threshold.label}</text>
              ) : null}
            </g>
          ) : null}
          {geo.lines.map(({ s, tone, segs }) =>
            segs.map((pts, k) => {
              const color = seriesColor(tone);
              if (pts.length === 1) return <circle key={`${s.id}-p${k}`} cx={pts[0].x} cy={pts[0].y} r={2.5} fill={color} data-role="dot" />;
              const d = monotonePath(pts);
              const draw = animate && !mounted ? "mpg-draw" : undefined;
              return (
                <g key={`${s.id}-l${k}`}>
                  <path d={d} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={5} filter={`url(#${ids.glow})`} data-role="glow" />
                  <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className={draw} data-role="line" />
                </g>
              );
            }),
          )}
        </g>

        {selected && !isSpark ? (
          <g data-role="selection">
            <line x1={selected.px} x2={selected.px} y1={pad.top} y2={baseY} stroke={GLOW_COLORS.label} strokeOpacity={0.4} strokeDasharray="2 3" />
            <circle cx={selected.px} cy={selected.py} r={4} fill={GLOW_COLORS.canvas} stroke={GLOW_COLORS.primary} strokeWidth={2} />
          </g>
        ) : null}

        {!isSpark && !noData ? (
          <rect x={0} y={0} width={width} height={h} fill="transparent" onPointerMove={onPointer} onPointerDown={onPointer} data-role="hit" />
        ) : null}
        {noData && !isSpark ? (
          <text x={width / 2} y={h / 2} textAnchor="middle" fontSize={12} fill={GLOW_COLORS.label}>No recorded observations</text>
        ) : null}
      </svg>

      {bubble ? (
        <div className="mpg-bubble" style={{ left: bubble.left, top: bubble.top, maxWidth: bubble.w }} data-role="bubble">
          <b>{bubble.lines[0]}</b>
          {bubble.lines.slice(1).map((l) => <span key={l} style={{ display: "block" }}>{l}</span>)}
        </div>
      ) : null}

      <div className="mpg-sr" aria-live="polite" aria-atomic="true">{announce}</div>
      {!isSpark ? (
        <details className="mpg-sr" id={ids.list}>
          <summary>{`${title}: data table`}</summary>
          <table>
            <thead><tr><th>Series</th><th>Observation</th><th>Value</th></tr></thead>
            <tbody>
              {visible.flatMap((s) =>
                s.points.map((p) => (
                  <tr key={`${s.id}-${p.id}`}><td>{s.label}</td><td>{p.label}</td><td>{p.value === null ? "Not recorded" : p.formattedValue}</td></tr>
                )),
              )}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}

export function GlowSparkline(props: Omit<GlowLineChartProps, "variant">) {
  return <GlowLineChart {...props} variant="sparkline" />;
}
