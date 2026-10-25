"use client";
import "./viz.css";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { SeriesPoint } from "./series";
import { fixed } from "./_fallback/format";

interface TipProps { active?: boolean; payload?: { payload: SeriesPoint }[] }
function Tip({ active, payload }: TipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded border border-white/15 bg-[var(--viz-surface)] px-2 py-1 text-xs text-[var(--viz-text)] shadow">
      <div className="font-medium">{p.label}</div>
      <div>value {p.value.toFixed(4)} %</div>
      <div>peak {p.peak.toFixed(4)} %</div>
      <div>decline {fixed(p.decline, 4)} pp</div>
      <div>excess {fixed(p.excess, 4)} pp·mo</div>
    </div>
  );
}

export function PathChart({ data, k, marker }: { data: SeriesPoint[]; k: number; marker: number | null }) {
  const m = marker === null ? undefined : data[marker];
  return (
    <div className="viz-root w-full min-w-0">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--viz-muted)]">
        <span><i className="mr-1 inline-block h-0.5 w-4 align-middle bg-[var(--viz-value)]" />CPI YoY</span>
        <span><i className="mr-1 inline-block h-0.5 w-4 align-middle bg-[var(--viz-peak)]" />Running peak</span>
        <span><i className="mr-1 inline-block h-0 w-4 align-middle border-t-2 border-dashed border-[var(--viz-k)]" />k</span>
        <span><i className="mr-1 inline-block h-2 w-4 align-middle bg-[var(--viz-excess)] opacity-25" />Excess above k</span>
        {m ? <span>● Max decline reached ({m.label})</span> : null}
      </div>
      <div className="h-64 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--viz-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--viz-grid)" }} minTickGap={24} />
            <YAxis tick={{ fill: "var(--viz-muted)", fontSize: 11 }} tickLine={false} axisLine={false} unit="%" width={48} />
            <Tooltip content={<Tip />} cursor={{ stroke: "var(--viz-muted)", strokeDasharray: "2 2" }} />
            <Area dataKey="excessBand" stroke="none" fill="var(--viz-excess)" fillOpacity={0.22} isAnimationActive={false} />
            <ReferenceLine y={k} stroke="var(--viz-k)" strokeDasharray="5 4" strokeWidth={1.5} />
            <Line type="stepAfter" dataKey="peak" stroke="var(--viz-peak)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="value" stroke="var(--viz-value)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            {m ? <ReferenceDot x={m.label} y={m.value} r={5} fill="var(--viz-peak)" stroke="var(--viz-surface)" strokeWidth={2} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
