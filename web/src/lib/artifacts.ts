// Research artifacts (off chain, advisory): forecast/manifest.json, forecast/table.json, forecast/planner.json.
// Schemas (shared, in @macropaths/client) cover only the fields the /forecast and /planner pages read.
import type { Forecast, Manifest, ManifestProduct } from "@macropaths/client";
import bundleIdentity from "../../public/data/bundle-identity.json";

/** Id of the published research bundle (also served as /data/bundle-identity.json and in /api/artifacts/bundle).
 *  Use with researchBundleQuery(PUBLISHED_BUNDLE_ID) from @/lib/queries. */
export const PUBLISHED_BUNDLE_ID: string = bundleIdentity.id;

// Shared schemas (client contract) and legacy queries (worker 10) re-exported for compatibility; nothing is defined here.
export { Manifest, ManifestProduct, Forecast, Fit, Scenario, PlannerArtifact } from "@macropaths/client";
export { manifestQuery, forecastQuery, plannerQuery, researchBundleQuery } from "@/lib/queries/research";

/** "2026-10-24T13:29:31Z" -> "2026-10-24 13:29 UTC": the data date of a source snapshot. */
export function fmtRetrieved(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

/** Where the research artefacts came from: source snapshot dates plus the model label and version. */
export function provenance(m: Manifest, f: Forecast) {
  return {
    snapshots: Object.entries(m.snapshots ?? {}).map(([id, s]) => ({ id, retrievedAt: fmtRetrieved(s.retrieved_at) })),
    label: f.label,
    model: f.model,
    version: `artefact v${f.manifest_version ?? m.version}, ${f.n_paths.toLocaleString("en-US")} simulated paths${f.seed === undefined ? "" : `, seed ${f.seed}`}`,
  };
}

export type ProductStatus = { label: string; tone: "good" | "warn" | "muted"; detail: string };

/** What the deployed program can do with a product. Only products with an on-chain index exist there. */
export function productStatus(p: Pick<ManifestProduct, "key" | "executable" | "index">): ProductStatus {
  if (!p.executable || p.index === null)
    return { label: "research proposal, not executable", tone: "warn", detail: "Not part of the deployed program." };
  if (p.key === "cooling")
    return { label: "view", tone: "muted", detail: `On-chain product ${p.index}, scored in the same session as Excess Inflation.` };
  return { label: "executable on chain", tone: "good", detail: `On-chain product ${p.index}.` };
}

/** Seller entry quote p in millionths for a product key (research products use the research quote). */
export function quoteFor(f: Forecast, key: string): number {
  const i = f.quotes.products.indexOf(key);
  return i >= 0 ? f.quotes.p[i] : f.quotes.fuel_research_quote;
}
