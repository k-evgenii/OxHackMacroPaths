"use client";
// One research product on the Forecast page: manifest terms, seller entry quote, forecast chart and the realised
// 2021-24 showcase. The cap and the showcase score are the research p90 parameterisation, not a session's terms.
import type { SessionView } from "@macropaths/client";
import { productStatus, quoteFor, type Forecast, type ManifestProduct } from "@/lib/artifacts";
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
}: {
  p: ManifestProduct;
  f: Forecast;
  showcase: { stat: number; score: number };
  session?: SessionView;
}) {
  const key = p.key as Key;
  const quote = quoteFor(f, key);
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
        <ForecastChart rows={f.rows} productKey={key} />
        <p className="mt-1 text-xs text-white/50">Expected score V by period, band V ± σ; {ILLUSTRATION}.</p>
      </div>
      <div className="mt-3 rounded border border-white/10 p-3 text-sm">
        Realised 2021-24 ({RESEARCH_ILLUSTRATION}, scored against the {RESEARCH_CAP}): statistic {scaled(showcase.stat, p.cap_units)},
        score {(showcase.score / 1e6).toFixed(6)}
      </div>
    </Card>
  );
}
