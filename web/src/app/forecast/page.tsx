"use client";
// Research layer, advisory only: AR(1) forecast table and manifest beside the on-chain products. Read-only.
import { useQueries } from "@tanstack/react-query";
import { forecastQuery, manifestQuery, productStatus, quoteFor, type Fit, type Forecast, type ManifestProduct } from "@/lib/artifacts";
import { Provenance } from "@/components/shell/Provenance";
import { Badge, Card, ErrorState, Skeleton, Stat } from "../planner/_fallback";
import { ForecastChart } from "./forecast-chart";

const ILLUSTRATION = "illustration until settlement";
type Key = "cooling" | "excess" | "fuel";

/** "1e-4 pp-months" with 1883141 -> "188.3141 pp-months". */
function scaled(value: number, units: string): string {
  const m = units.match(/^1e(-?\d+)\s+(.*)$/);
  if (!m) return `${value} ${units}`;
  const exp = -Number(m[1]);
  return `${(value / 10 ** exp).toFixed(exp)} ${m[2]}`;
}
const pct = (millionths: number) => `${(millionths / 1e4).toFixed(4)} %`;

function FitSummary({ name, fit }: { name: string; fit: Fit }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat label={`${name}: a`} value={fit.a.toFixed(3)} />
      <Stat label="b" value={fit.b.toFixed(6)} />
      <Stat label="resid_sd" value={fit.resid_sd.toFixed(2)} />
      <Stat label="half-life" value={`${fit.half_life_months.toFixed(1)} mo`} />
      <Stat label="fit window" value={`${fit.fit_window[0]}..${fit.fit_window[1]}`} hint={`n = ${fit.n}`} />
    </div>
  );
}

function ProductCard({ p, f, showcase }: { p: ManifestProduct; f: Forecast; showcase: { stat: number; score: number } }) {
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
        <Stat label="cap (p90)" value={scaled(p.cap, p.cap_units)} hint={`${p.cap} × ${p.cap_units}`} />
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
        Realised 2021-24: statistic {scaled(showcase.stat, p.cap_units)}, score {(showcase.score / 1e6).toFixed(6)}
      </div>
    </Card>
  );
}

export default function ForecastPage() {
  const [m, f] = useQueries({ queries: [manifestQuery, forecastQuery] });
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Forecast</h1>
        <p className="mt-1 text-sm text-amber-200/80">{f.data?.label ?? "Forecast (AR(1) baseline, advisory). Settlement uses the realised path only."}</p>
      </header>
      <Provenance />
      {m.error || f.error ? <ErrorState error={m.error ?? f.error} /> : null}
      {!m.data || !f.data ? (
        m.error || f.error ? null : <Skeleton className="h-96" />
      ) : (
        <>
          <Card title="AR(1) fit">
            <div className="space-y-4">
              <FitSummary name="CPI yoy" fit={f.data.fit.cpi} />
              <FitSummary name="Fuel" fit={f.data.fit.fuel} />
            </div>
            <p className="mt-3 text-xs text-white/50">
              {f.data.model}; {f.data.n_paths.toLocaleString("en-US")} simulated paths. Quote formula: <code>{f.data.quotes.formula}</code>
            </p>
          </Card>
          {m.data.products.map((p) => (
            <ProductCard key={p.key} p={p} f={f.data} showcase={m.data.showcase[p.key as Key]} />
          ))}
          <Card title={`Showcase ${m.data.showcase.window[0]}..${m.data.showcase.window[1]} (realised)`}>
            <ul className="space-y-1 text-sm">
              {m.data.products.map((p) => {
                const s = m.data.showcase[p.key as Key];
                return (
                  <li key={p.key}>
                    {p.name}: statistic {scaled(s.stat, p.cap_units)}, score {(s.score / m.data.one).toFixed(6)}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-white/50">
              historical showcase, not a validation set. Scores use the caps listed above; an on-chain session scores against the caps in
              its own terms, which can differ.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
