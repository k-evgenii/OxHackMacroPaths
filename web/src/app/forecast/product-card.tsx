"use client";
// One research product on the Forecast page: manifest terms, seller entry quote, forecast chart and the realised
// 2021-24 showcase. The cap and the showcase score are the research p90 parameterisation, not a session's terms.
import { useEffect, useState } from "react";
import type { SessionView } from "@macropaths/client";
import { productStatus, quoteFor, type Conditional, type Forecast, type ManifestProduct } from "@/lib/artifacts";
import { RESEARCH_CAP, RESEARCH_ILLUSTRATION, sessionCapText } from "@/components/shell/ResearchCaps";
import { Badge, Card, Stat } from "../planner/_fallback";
import { ForecastChart } from "./forecast-chart";

export const ILLUSTRATION = "illustration until settlement";
export type Key = "cooling" | "excess" | "fuel";

/** "1e-4 pp-months" with 1883141 -> "188.3141 pp-months". */
export function scaled(value: number, units: string): string {
  const m = units.match(/^1e(-?\d+)\s+(.*)$/);
  if (!m) return `${value} ${units}`;
  const exp = -Number(m[1]);
  return `${(value / 10 ** exp).toFixed(exp)} ${m[2]}`;
}
const pct = (millionths: number) => `${(millionths / 1e4).toFixed(4)} %`;

export function ProductCard({
  p,
  f,
  showcase,
  session,
  cond,
}: {
  p: ManifestProduct;
  f: Forecast;
  showcase: { stat: number; score: number };
  session?: SessionView;
  cond?: Conditional;
}) {
  const key = p.key as Key;
  const [origin, setOrigin] = useState(0);
  useEffect(() => {
    const o = Number(new URLSearchParams(window.location.search).get("origin"));
    if (Number.isInteger(o) && o >= 0 && o < 48) setOrigin(o);
  }, []);
  const linked = key === "excess" && cond !== undefined;
  const c = linked ? cond.rows[origin] : undefined;
  // Origin 0 shows the table quote unchanged; later origins apply the same formula to the conditional V and sigma.
  const quote = c && origin > 0 ? Math.floor(Math.min(0.95, Math.max(0.05, c.V + 0.5 * c.sigma)) * 1e6) : quoteFor(f, key);
  const status = productStatus(p);
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {p.name}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="statistic" value={p.stat} hint={p.row} />
        <Stat label="threshold k" value={p.k === null ? "none" : scaled(p.k, p.cap_units.replace(/-months$/, ""))} />
        <Stat label={RESEARCH_CAP} value={scaled(p.cap, p.cap_units)} hint={sessionCapText(p, session) ?? `${p.cap} × ${p.cap_units}`} />
        <Stat label="seller entry quote p" value={pct(quote)} hint={`${quote} millionths, ${ILLUSTRATION}`} />
      </div>
      <p className="mt-2 text-xs text-white/50">
        {p.windows} windows {p.first_window}..{p.last_window}
        {p.index !== null ? `, on-chain product ${p.index}` : ""}. {status.detail}
        {p.note ? `; ${p.note}` : ""}
      </p>
      <div className="mt-4">
        {linked ? (
          <label className="mb-2 flex items-center gap-3 text-xs text-white/70">
            Origin month
            <input type="range" min={0} max={cond.rows.length - 1} value={origin} onChange={(e) => setOrigin(Number(e.target.value))} className="flex-1" />
            <span className="w-24 tabular-nums">
              {origin} ({String(c?.period_id).slice(0, 4)}-{String(c?.period_id).slice(4)})
            </span>
          </label>
        ) : null}
        <ForecastChart rows={f.rows} productKey={key} conditional={linked ? cond : undefined} origin={origin} />
        <p className="mt-1 text-xs text-white/50">
          {linked
            ? `Solid: realised score up to the origin month. Dashed: expected score V after it, band V ± σ conditional on the realised path; ${ILLUSTRATION}.`
            : `Expected score V by period, band V ± σ; ${ILLUSTRATION}.`}{" "}
          Advisory; settlement uses the realised path only.
        </p>
      </div>
      <div className="mt-3 rounded border border-white/10 p-3 text-sm">
        Realised 2021-24 ({RESEARCH_ILLUSTRATION}, scored against the {RESEARCH_CAP}): statistic {scaled(showcase.stat, p.cap_units)},
        score {(showcase.score / 1e6).toFixed(6)}
      </div>
    </Card>
  );
}
