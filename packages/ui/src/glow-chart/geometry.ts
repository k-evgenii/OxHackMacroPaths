/* Pure geometry helpers for GlowLineChart. Display-only: nothing here may feed
 * payouts, settlement or any economic statistic. */
import type { GlowPoint, GlowSeries } from "./types";

export type Box = { left: number; top: number; width: number; height: number };
export type XY = { x: number; y: number };

export function isObserved(p: GlowPoint): p is GlowPoint & { value: number } {
  return p.value !== null && Number.isFinite(p.value) && Number.isFinite(p.x);
}

/** Bounded y domain; handles empty, flat, single-point and negative data; includes the threshold. */
export function yDomain(series: GlowSeries[], threshold?: { value: number }): [number, number] {
  const vals: number[] = [];
  for (const s of series) for (const p of s.points) if (isObserved(p)) vals.push(p.value);
  if (threshold && Number.isFinite(threshold.value)) vals.push(threshold.value);
  if (vals.length === 0) return [0, 1];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  return [lo, hi];
}

export function xDomain(series: GlowSeries[], ticks: Array<{ x: number }> = []): [number, number] {
  const xs: number[] = [];
  for (const s of series) for (const p of s.points) if (Number.isFinite(p.x)) xs.push(p.x);
  for (const t of ticks) if (Number.isFinite(t.x)) xs.push(t.x);
  if (xs.length === 0) return [0, 1];
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return hi === lo ? [lo - 0.5, hi + 0.5] : [lo, hi];
}

export function makeScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** Up to `count` evenly spaced ticks inside the domain (3-5 muted labels, no gridlines). */
export function yTicks(domain: [number, number], count = 4): number[] {
  const [lo, hi] = domain;
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out.slice(0, 5);
}

/** Split into contiguous observed runs; null values break the line (never bridged). */
export function segments(points: GlowPoint[]): GlowPoint[][] {
  const out: GlowPoint[][] = [];
  let cur: GlowPoint[] = [];
  for (const p of points) {
    if (isObserved(p)) cur.push(p);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Monotone cubic (Fritsch-Carlson / Steffen-style) path through the given pixel points.
 * Passes through every point; control points never leave the y-range of their segment,
 * so the curve cannot overshoot adjacent extrema.
 */
export function monotonePath(pts: XY[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  const d: number[] = [];
  const h: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(pts[i + 1].x - pts[i].x);
    d.push(h[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h[i]);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      // Steffen: guarantees monotonicity per interval.
      const p = (d[i - 1] * h[i] + d[i] * h[i - 1]) / (h[i - 1] + h[i]);
      const lim = 2 * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]));
      m[i] = Math.sign(d[i]) * Math.min(Math.abs(p), lim);
    }
  }
  // End slopes clamp so the first/last interval stays monotone too.
  if (n > 2) {
    m[0] = Math.sign(d[0]) * Math.min(Math.abs(m[0]), 2 * Math.abs(d[0]));
    m[n - 1] = Math.sign(d[n - 2]) * Math.min(Math.abs(m[n - 1]), 2 * Math.abs(d[n - 2]));
  }
  let s = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const t = h[i] / 3;
    s += `C${f(a.x + t)},${f(a.y + m[i] * t)},${f(b.x - t)},${f(b.y - m[i + 1] * t)},${f(b.x)},${f(b.y)}`;
  }
  return s;
}

/** Closed area under a monotone path down to baseY. */
export function areaPath(pts: XY[], baseY: number): string {
  if (pts.length < 2) return "";
  return `${monotonePath(pts)}L${f(pts[pts.length - 1].x)},${f(baseY)}L${f(pts[0].x)},${f(baseY)}Z`;
}

export type Located = { seriesId: string; point: GlowPoint; px: number; py: number };

/** Nearest actual observed point to a pointer position (x distance first, then y). */
export function nearestPoint(located: Located[], px: number, py?: number): Located | null {
  let best: Located | null = null;
  let bestD = Infinity;
  for (const l of located) {
    const dx = Math.abs(l.px - px);
    const dy = py === undefined ? 0 : Math.abs(l.py - py) * 0.001;
    const dist = dx + dy;
    if (dist < bestD) {
      bestD = dist;
      best = l;
    }
  }
  return best;
}

/** Keyboard navigation over observed points in x order. */
export function stepSelection(order: Located[], currentId: string | null, key: string): Located | null {
  if (order.length === 0) return null;
  const idx = currentId === null ? -1 : order.findIndex((l) => l.point.id === currentId);
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return order[idx < 0 ? 0 : Math.min(order.length - 1, idx + 1)];
    case "ArrowLeft":
    case "ArrowUp":
      return order[idx < 0 ? order.length - 1 : Math.max(0, idx - 1)];
    case "Home":
      return order[0];
    case "End":
      return order[order.length - 1];
    default:
      return idx < 0 ? null : order[idx];
  }
}

/** Left offset that keeps a tooltip bubble of `bubbleW` fully inside [0, containerW]. */
export function clampBubble(anchorX: number, bubbleW: number, containerW: number, margin = 4): number {
  const w = Math.min(bubbleW, Math.max(0, containerW - margin * 2));
  const left = anchorX - w / 2;
  return Math.max(margin, Math.min(containerW - margin - w, left));
}

/** Rough bubble width estimate in px for monospace-ish label sizing (SSR-safe). */
export function estimateBubbleWidth(lines: string[], charPx = 7.2, padding = 20): number {
  return Math.ceil(Math.max(0, ...lines.map((l) => l.length)) * charPx + padding);
}
