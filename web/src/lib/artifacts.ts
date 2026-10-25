// Research artifacts (off chain, advisory): forecast/manifest.json, forecast/table.json, forecast/planner.json.
// Schemas cover only the fields the /forecast and /planner pages read.
import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import bundleIdentity from "../../public/data/bundle-identity.json";

/** Id of the published research bundle (also served as /data/bundle-identity.json and in /api/artifacts/bundle). */
export const PUBLISHED_BUNDLE_ID: string = bundleIdentity.id;

const ManifestProduct = z.object({
  index: z.number().nullable(),
  key: z.string(),
  name: z.string(),
  stat: z.string(),
  row: z.string(),
  k: z.number().nullable(),
  cap: z.number(),
  cap_units: z.string(),
  windows: z.number(),
  first_window: z.string(),
  last_window: z.string(),
  executable: z.boolean(),
  note: z.string().optional(),
});
export type ManifestProduct = z.infer<typeof ManifestProduct>;

const StatScore = z.object({ stat: z.number(), score: z.number() });
const Snapshot = z.object({ retrieved_at: z.string() });
export const Manifest = z.object({
  version: z.number(),
  // Source snapshots the artefacts were computed from; retrieved_at is the data date shown on research screens.
  snapshots: z.record(Snapshot).optional(),
  products: z.array(ManifestProduct),
  showcase: z.object({
    window: z.tuple([z.string(), z.string()]),
    cooling: StatScore,
    excess: StatScore,
    fuel: StatScore.extend({ months_above_k: z.number().optional() }),
  }),
  one: z.number(),
});
export type Manifest = z.infer<typeof Manifest>;

const Fit = z.object({
  a: z.number(),
  b: z.number(),
  resid_sd: z.number(),
  n: z.number(),
  fit_window: z.tuple([z.string(), z.string()]),
  half_life_months: z.number(),
});
export type Fit = z.infer<typeof Fit>;
const Cell = z.object({ V: z.number(), sigma: z.number() });

export const Forecast = z.object({
  manifest_version: z.number().optional(),
  model: z.string(),
  seed: z.number().optional(),
  n_paths: z.number(),
  fit: z.object({ cpi: Fit, fuel: Fit }),
  quotes: z.object({
    p: z.array(z.number()),
    products: z.array(z.string()),
    formula: z.string(),
    fuel_research_quote: z.number(),
  }),
  label: z.string(),
  // The terminal row (t = 48, the realised end state) has no calendar period: period_id is null there.
  rows: z.array(z.object({ t: z.number(), period_id: z.number().nullable(), cooling: Cell, excess: Cell, fuel: Cell })),
});
export type Forecast = z.infer<typeof Forecast>;

export const Scenario = z.object({
  start: z.string(),
  excess_score: z.number(),
  fuel_score: z.number(),
  fuel_overrun_per_gallon: z.number(),
});
export type Scenario = z.infer<typeof Scenario>;

const ResultRow = z.object({
  product: z.enum(["cash", "excess", "fuel"]),
  stake: z.number(),
  units: z.number(),
  tail_loss_95: z.number(),
  mean_shortfall: z.number(),
  max_shortfall: z.number(),
  cap_binding_freq: z.number(),
  expected_end_cash: z.number(),
});

const Showcase = z.object({
  overrun: z.number(),
  stake: z.number(),
  units: z.number(),
  payout: z.number(),
  remaining_cash: z.number(),
  shortfall: z.number(),
  cash_baseline_shortfall: z.number(),
});

export const PlannerArtifact = z.object({
  manifest_version: z.number().optional(),
  prices: z.object({ excess: z.number(), fuel: z.number() }),
  caps: z.object({ cooling: z.number(), excess: z.number(), fuel: z.number() }),
  thresholds: z.object({ excess_k_1e4pp: z.number(), fuel_k_1e4usd: z.number() }),
  scenario_note: z.string(),
  defaults: z.object({ q: z.number(), G: z.number(), B: z.number() }),
  scenarios: z.array(Scenario),
  showcase: Scenario.extend({ under_recommended: Showcase }),
  default_recommendation: ResultRow,
  default_table: z.array(ResultRow),
});
export type PlannerArtifact = z.infer<typeof PlannerArtifact>;

// Static research files: fetched once per page load. Keys carry the bundle id so a republished bundle never
// reuses a stale cache entry.
export const manifestQuery = queryOptions({
  queryKey: ["artifact", "manifest", PUBLISHED_BUNDLE_ID],
  queryFn: () => fetchJson("/api/artifacts/manifest", Manifest),
  staleTime: Infinity,
});
export const forecastQuery = queryOptions({
  queryKey: ["artifact", "forecast", PUBLISHED_BUNDLE_ID],
  queryFn: () => fetchJson("/api/artifacts/forecast", Forecast),
  staleTime: Infinity,
});
export const plannerQuery = queryOptions({
  queryKey: ["artifact", "planner", PUBLISHED_BUNDLE_ID],
  queryFn: () => fetchJson("/api/artifacts/planner", PlannerArtifact),
  staleTime: Infinity,
});

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
