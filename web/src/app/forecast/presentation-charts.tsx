"use client";
import { CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Presentation } from "@/lib/artifacts";

const ADVISORY = "advisory; settlement uses the realised path only";
const FILL_TIP = "filled with the Treasury contingency value 325.604; illustrative historical data";
const THIN_TIP = "fewer than 3 weekly readings";
const AXIS = { fill: "rgba(255,255,255,0.5)", fontSize: 11 };
const BOX = { background: "#1b1512", border: "1px solid rgba(255,255,255,0.15)", fontSize: 12, padding: "4px 8px" } as const;

type CpiPt = { label: string; value: number; filled: boolean };
type FuelPt = { label: string; value: number; thin: boolean; readings: number };

function CpiTip({ active, payload }: { active?: boolean; payload?: { payload: CpiPt }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div style={BOX}>
      <div>{p.label}</div>
      <div>index {p.value.toFixed(3)}</div>
      {p.filled ? <div className="text-amber-200">{FILL_TIP}</div> : null}
    </div>
  );
}

/** CPIAUCNS 2020 onward. The filled month carries a hollow marker so the gap is visible, not hidden. */
export function CpiChart({ rows }: { rows: Presentation["cpi"]["rows"] }) {
  const data: CpiPt[] = rows
    .filter((r) => r.date >= "2020-01-01")
    .map((r) => ({ label: r.date.slice(0, 7), value: Number(r.value_str), filled: r.filled }));
  const hole = data.find((d) => d.filled);
  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} minTickGap={32} />
            <YAxis domain={["auto", "auto"]} tick={AXIS} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<CpiTip />} />
            <Line dataKey="value" stroke="#6ea8fe" strokeWidth={2} dot={false} isAnimationActive={false} />
            {hole ? <ReferenceDot x={hole.label} y={hole.value} r={6} fill="#1b1512" stroke="#fbbf24" strokeWidth={2} ifOverflow="visible" /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-white/50">
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-amber-400 align-middle" />
        {hole?.label}: {FILL_TIP}. {ADVISORY}.
      </p>
    </div>
  );
}

function FuelTip({ active, payload }: { active?: boolean; payload?: { payload: FuelPt }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div style={BOX}>
      <div>{p.label}</div>
      <div>${p.value.toFixed(4)} / gal</div>
      {p.thin ? (
        <div className="text-amber-200">
          † {THIN_TIP} ({p.readings})
        </div>
      ) : null}
    </div>
  );
}

function Dagger({ cx, cy, payload }: { cx?: number; cy?: number; payload?: FuelPt }) {
  if (!payload?.thin || cx === undefined || cy === undefined) return <g />;
  return (
    <text x={cx} y={cy - 4} textAnchor="middle" fill="#fbbf24" fontSize={13} fontWeight={700}>
      †
    </text>
  );
}

/** GASREGW monthly mean; months built from fewer than 3 weekly readings carry a dagger. */
export function FuelChart({ rows }: { rows: Presentation["fuel"]["rows"] }) {
  const data: FuelPt[] = rows.map((r) => ({ label: r.month, value: r.value / 1e4, thin: r.thin, readings: r.readings }));
  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tick={AXIS} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<FuelTip />} />
            <Line dataKey="value" stroke="#6ea8fe" strokeWidth={2} dot={<Dagger />} activeDot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-white/50">
        † {THIN_TIP}. Illustrative historical data; {ADVISORY}.
      </p>
    </div>
  );
}
