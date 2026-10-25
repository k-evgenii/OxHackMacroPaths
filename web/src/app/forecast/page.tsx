"use client";
// Research layer, advisory only: AR(1) forecast table and manifest beside the on-chain products. Read-only.
import { useQueries } from "@tanstack/react-query";
import { conditionalQuery, forecastQuery, manifestQuery, presentationQuery, type Fit } from "@/lib/artifacts";
import { DEFAULT_SESSION } from "@/lib/api-client";
import { useSession } from "@/lib/hooks";
import { Provenance } from "@/components/shell/Provenance";
import { RESEARCH_CAP, RESEARCH_ILLUSTRATION, sessionTermsText } from "@/components/shell/ResearchCaps";
import { Card, ErrorState, Skeleton, Stat } from "../planner/_fallback";
import { ProductCard, scaled, type Key } from "./product-card";
import { CpiChart, FuelChart } from "./presentation-charts";

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

export default function ForecastPage() {
  const [m, f, cd, pr] = useQueries({ queries: [manifestQuery, forecastQuery, conditionalQuery, presentationQuery] });
  // The reference session gives the on-chain caps to show beside the research p90 caps; optional, never blocking.
  const session = useSession(DEFAULT_SESSION).data;
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
            <ProductCard key={p.key} p={p} f={f.data} showcase={m.data.showcase[p.key as Key]} session={session} cond={cd.data} />
          ))}
          {pr.data ? (
            <>
              <Card title="CPI index (CPIAUCNS), 2020 onward">
                <CpiChart rows={pr.data.cpi.rows} />
                <p className="mt-1 text-xs text-white/50">{pr.data.cpi.source}</p>
              </Card>
              <Card title="Regular gasoline (GASREGW), monthly mean">
                <FuelChart rows={pr.data.fuel.rows} />
                <p className="mt-1 text-xs text-white/50">{pr.data.fuel.source}</p>
              </Card>
            </>
          ) : null}
          <Card title={`Showcase ${m.data.showcase.window[0]}..${m.data.showcase.window[1]} (realised, ${RESEARCH_ILLUSTRATION})`}>
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
              historical showcase, not a validation set. Scores use the {RESEARCH_CAP} listed above; an on-chain session scores
              against the caps in its own terms, which can differ{session ? `: ${sessionTermsText(session)}` : ""}.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
