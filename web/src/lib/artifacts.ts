// Research artifacts (off chain, advisory): forecast/manifest.json, forecast/table.json, forecast/planner.json.
// Schemas cover only the fields the /forecast and /planner pages read.
import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";

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
export const Manifest = z.object({
  version: z.number(),
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
  model: z.string(),
  n_paths: z.number(),
  fit: z.object({ cpi: Fit, fuel: Fit }),
  quotes: z.object({
    p: z.array(z.number()),
    products: z.array(z.string()),
    formula: z.string(),
    fuel_research_quote: z.number(),
  }),
  label: z.string(),
  rows: z.array(z.object({ t: z.number(), period_id: z.number(), cooling: Cell, excess: Cell, fuel: Cell })),
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

// Static research files: fetched once per page load.
export const manifestQuery = queryOptions({
  queryKey: ["artifact", "manifest"],
  queryFn: () => fetchJson("/api/artifacts/manifest", Manifest),
  staleTime: Infinity,
});
export const forecastQuery = queryOptions({
  queryKey: ["artifact", "forecast"],
  queryFn: () => fetchJson("/api/artifacts/forecast", Forecast),
  staleTime: Infinity,
});
export const plannerQuery = queryOptions({
  queryKey: ["artifact", "planner"],
  queryFn: () => fetchJson("/api/artifacts/planner", PlannerArtifact),
  staleTime: Infinity,
});
