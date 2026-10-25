"use client";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Conditional, Forecast } from "@/lib/artifacts";

const LINE = "#6ea8fe";
const REAL = "#f2e9dc";
const ADVISORY = "advisory; settlement uses the realised path only";
// The terminal row (t = 48, realised end state) has no calendar period.
const fmtPeriod = (id: number | null) => (id === null ? "final" : `${String(id).slice(0, 4)}-${String(id).slice(4)}`);

type Pt = { period: string; V?: number; sigma?: number; band?: [number, number]; realised?: number };

export function ForecastChart({
  rows,
  productKey,
  conditional,
  origin = 0,
}: {
  rows: Forecast["rows"];
  productKey: "cooling" | "excess" | "fuel";
  /** Conditional V and sigma per origin month (Excess only). Without it the origin-0 forecast is drawn. */
  conditional?: Conditional;
  origin?: number;
}) {
  const linked = productKey === "excess" && conditional !== undefined;
  const data: Pt[] = linked
    ? conditional.rows.map((c, i) => ({
        period: fmtPeriod(c.period_id),
        realised: i <= origin ? rows[i]?.excess.accrued_floor : undefined,
        V: i >= origin ? c.V : undefined,
        sigma: c.sigma,
        band: i >= origin ? ([Math.max(0, c.V - c.sigma), Math.min(1, c.V + c.sigma)] as [number, number]) : undefined,
      }))
    : rows.map((r) => {
        const { V, sigma } = r[productKey];
        return { period: fmtPeriod(r.period_id), V, band: [Math.max(0, V - sigma), Math.min(1, V + sigma)] as [number, number], sigma };
      });
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="period" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} interval={11} tickLine={false} />
          <YAxis domain={[0, 1]} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: "#1b1512", border: "1px solid rgba(255,255,255,0.15)", fontSize: 12 }}
            labelFormatter={(l) => `${l} (${ADVISORY})`}
            formatter={(v, name) =>
              name === "band" && Array.isArray(v)
                ? [`${Number(v[0]).toFixed(4)} .. ${Number(v[1]).toFixed(4)}`, "V ± σ"]
                : name === "realised"
                  ? [Number(v).toFixed(4), "realised score so far"]
                  : [Number(v).toFixed(4), "V"]
            }
          />
          <Area dataKey="band" stroke="none" fill={LINE} fillOpacity={0.18} isAnimationActive={false} />
          {linked ? <Line dataKey="realised" stroke={REAL} strokeWidth={2} dot={false} isAnimationActive={false} /> : null}
          <Line dataKey="V" stroke={LINE} strokeWidth={2} strokeDasharray={linked ? "5 4" : undefined} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
