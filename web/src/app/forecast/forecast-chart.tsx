"use client";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Forecast } from "@/lib/artifacts";

const LINE = "#6ea8fe";
const fmtPeriod = (id: number) => `${String(id).slice(0, 4)}-${String(id).slice(4)}`;

export function ForecastChart({ rows, productKey }: { rows: Forecast["rows"]; productKey: "cooling" | "excess" | "fuel" }) {
  const data = rows.map((r) => {
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
            formatter={(v, name) =>
              name === "band" && Array.isArray(v)
                ? [`${Number(v[0]).toFixed(4)} .. ${Number(v[1]).toFixed(4)}`, "V ± σ"]
                : [Number(v).toFixed(4), "V"]
            }
          />
          <Area dataKey="band" stroke="none" fill={LINE} fillOpacity={0.18} isAnimationActive={false} />
          <Line dataKey="V" stroke={LINE} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
