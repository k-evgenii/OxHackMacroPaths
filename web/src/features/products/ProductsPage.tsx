"use client";
// Products catalogue: two CPI products with the selected session's actual on-chain offer, Fuel as
// research, and the planner. Read-only: no purchase flow. Model prices live in Research only.
import { fmtQuotePlay } from "@macropaths/client";
import { ErrorState, Skeleton } from "@macropaths/ui";
import { useCatalog, useResearchBundle, useSessionOverview } from "@/lib/hooks";
import { useSelectedSession } from "@/features/shell";
import { offerView, PRODUCT_COPY, type CoverOfferSection } from "./model";
import { PlannerSection } from "./PlannerSection";
import s from "./products.module.css";

function OfferBlock({ section, index, settled }: { section: CoverOfferSection | undefined; index: 0 | 1; settled: boolean }) {
  const o = offerView(section, index, settled);
  return (
    <div>
      <span className={s.pill}>{o.title}</span>
      {o.quoteMillionths !== null ? (
        <p className={s.quote}>{fmtQuotePlay(o.quoteMillionths)} PLAY per 1 PLAY maximum payout</p>
      ) : null}
      <p className={s.muted}>{o.description}</p>
      <p className={s.muted}>{o.actionNote}</p>
    </div>
  );
}

export function ProductsPage() {
  const catalog = useCatalog();
  const selected = useSelectedSession();
  const overview = useSessionOverview(selected.address);
  const bundleId = catalog.data?.research?.bundleId ?? null;
  const bundle = useResearchBundle(bundleId);

  if (catalog.error) return <ErrorState description="The product catalogue could not be loaded." onRetry={() => catalog.refetch()} />;
  if (!catalog.data) return <Skeleton label="Loading products" className={s.page} />;

  const settled = overview.data?.session.state === "Settled";
  const section = overview.data?.coverOffer as CoverOfferSection | undefined;
  const sessionLabel = overview.data?.presentation.label ?? "the selected session";
  const products = catalog.data.products;
  const order = ["excess", "cooling", "fuel"] as const;
  const assoc = bundle.data?.metadata.associatedSession ?? null;

  return (
    <div className={s.page}>
      <header>
        <h1 className={s.title}>Products</h1>
        <p className={s.lede}>Cover offers below use the actual terms and seller quote of {sessionLabel}. Historical replay on devnet with test PLAY.</p>
      </header>

      {overview.error ? (
        <ErrorState description="Session offer data could not be loaded." onRetry={() => overview.refetch()} />
      ) : null}

      <div className={s.grid}>
        {order.map((key) => {
          const p = products.find((x) => x.key === key);
          if (!p) return null;
          return (
            <article key={key} className={s.card} aria-labelledby={`product-${key}`}>
              <h2 id={`product-${key}`} className={s.cardTitle}>{PRODUCT_COPY[key].name}</h2>
              <span className={s.pill}>{p.status === "research" ? "Research" : "On chain"}</span>
              <p>{PRODUCT_COPY[key].description}</p>
              {p.productIndex !== null && p.status === "supported" ? (
                overview.data || overview.error ? (
                  <OfferBlock section={overview.error ? { status: "unavailable", data: null } : section} index={p.productIndex} settled={settled} />
                ) : (
                  <Skeleton label="Loading offer" />
                )
              ) : (
                <p className={s.muted}>Research only: there is no on-chain offer for this product.</p>
              )}
            </article>
          );
        })}
      </div>

      <section aria-labelledby="research-title" className={s.card}>
        <h2 id="research-title" className={s.cardTitle}>Research references</h2>
        {bundle.error ? (
          <ErrorState description="The research bundle could not be loaded." onRetry={() => bundle.refetch()} />
        ) : !bundle.data ? (
          bundleId ? <Skeleton label="Loading research" /> : <p className={s.muted}>No research bundle is published.</p>
        ) : (
          <>
            <p className={s.muted}>
              Model reference prices and caps from the research bundle. They are not live seller quotes
              {assoc && assoc === selected.address ? "." : " and are not the selected session's terms or results."}
            </p>
            <ul>
              {bundle.data.terms.map((t) => (
                <li key={t.key}>
                  {PRODUCT_COPY[t.key].name}: research reference {fmtQuotePlay(t.quoteMillionths)} per 1 unit of maximum payout
                  {t.researchOnly ? " (research only)" : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {bundle.data ? <PlannerSection art={bundle.data.planner} /> : null}
    </div>
  );
}
