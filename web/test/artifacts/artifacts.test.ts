// The committed research artefacts must satisfy the schemas the Forecast and Planner pages parse them with,
// and the helpers that label products and data dates must not overstate what the deployed program can do.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  Forecast,
  Manifest,
  PlannerArtifact,
  fmtRetrieved,
  productStatus,
  provenance,
  quoteFor,
} from "@/lib/artifacts";

const load = (name: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../public/data", `${name}.json`), "utf8"));
const manifest = Manifest.parse(load("manifest"));
const forecast = Forecast.parse(load("forecast"));

describe("committed artefacts parse", () => {
  it("manifest, forecast and planner satisfy their schemas", () => {
    expect(manifest.products.map((p) => p.key)).toEqual(["cooling", "excess", "fuel"]);
    expect(() => PlannerArtifact.parse(load("planner"))).not.toThrow();
  });
  it("the terminal forecast row (t = 48) has no calendar period; every other row has one", () => {
    // Regression: period_id was required to be a number, so /forecast failed with a raw zod error.
    const last = forecast.rows[forecast.rows.length - 1];
    expect(last.t).toBe(48);
    expect(last.period_id).toBeNull();
    expect(forecast.rows.slice(0, -1).every((r) => typeof r.period_id === "number")).toBe(true);
  });
});

describe("provenance", () => {
  it("formats the snapshot retrieval time as a data date", () => {
    expect(fmtRetrieved("2026-10-24T13:29:31Z")).toBe("2026-10-24 13:29 UTC");
    expect(fmtRetrieved("not a date")).toBe("not a date");
  });
  it("reports snapshot dates, model label and artefact version from the artefacts", () => {
    const p = provenance(manifest, forecast);
    expect(p.snapshots).toEqual([
      { id: "CPIAUCNS", retrievedAt: "2026-10-24 13:29 UTC" },
      { id: "GASREGW", retrievedAt: "2026-10-24 17:19 UTC" },
    ]);
    expect(p.label).toBe(forecast.label);
    expect(p.version).toBe("artefact v1, 10,000 simulated paths, seed 2026");
  });
  it("copes with a manifest that records no snapshots", () => {
    expect(provenance({ ...manifest, snapshots: undefined }, forecast).snapshots).toEqual([]);
  });
});

describe("productStatus", () => {
  const by = (key: string) => productStatus(manifest.products.find((p) => p.key === key)!);
  it("labels Inflation Cooling a view and Excess Inflation executable", () => {
    expect(by("cooling").label).toBe("view");
    expect(by("excess").label).toBe("executable on chain");
  });
  it("never presents a product without an on-chain index as executable", () => {
    const fuel = by("fuel");
    expect(fuel.label).toBe("research proposal, not executable");
    expect(fuel.tone).toBe("warn");
    expect(productStatus({ key: "excess", executable: true, index: null }).label).toMatch(/not executable/);
    expect(productStatus({ key: "excess", executable: false, index: 1 }).label).toMatch(/not executable/);
  });
});

describe("quoteFor", () => {
  it("reads the seller entry quotes from the forecast artefact, never a made-up number", () => {
    expect(quoteFor(forecast, "cooling")).toBe(forecast.quotes.p[0]);
    expect(quoteFor(forecast, "excess")).toBe(forecast.quotes.p[1]);
    expect(quoteFor(forecast, "fuel")).toBe(forecast.quotes.fuel_research_quote);
  });
});
