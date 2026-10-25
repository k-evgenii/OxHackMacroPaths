import { describe, expect, it } from "vitest";
import raw from "../../public/data/planner.json";
import { PlannerArtifact } from "@/lib/artifacts";
import { checkInputs } from "@/lib/planner";
import { offerView, planView, RESEARCH_USD_NOTE, type CoverOfferSection } from "@/features/products/model";

const art = PlannerArtifact.parse(raw);
const defaults = { gallons: art.defaults.q, budget: art.defaults.B };

describe("planView default bundle", () => {
  const v = planView(art, defaults);
  if (v.status !== "ok") throw new Error("expected ok");

  it("reads defaults from the artifact and recommends Fuel 40", () => {
    expect(defaults).toEqual({ gallons: 100, budget: 200 });
    expect(v.best.product).toBe(art.default_recommendation.product);
    expect(v.best.stake).toBeCloseTo(40, 9);
    expect(v.sentence).toContain("Fuel Research");
    expect(v.sentence).toContain("USD 40.00");
    expect(v.sentence).not.toMatch(/buy|purchase/i);
  });

  it("showcase residual vs cash agrees with the artifact", () => {
    expect(v.showcase.shortfall).toBeCloseTo(art.showcase.under_recommended.shortfall, 6);
    expect(v.showcase.cash_baseline_shortfall).toBeCloseTo(art.showcase.under_recommended.cash_baseline_shortfall, 6);
    expect(v.showcase.shortfall).toBeCloseTo(199.55, 2);
    expect(v.showcase.cash_baseline_shortfall).toBeCloseTo(528.33, 2);
  });

  it("does not present zero tail loss as protection", () => {
    expect(v.best.tail_loss_95).toBe(0);
    expect(v.tailNote).toMatch(/not guaranteed/);
  });

  it("chart: allocation x-axis, cash baseline in every series, no dates", () => {
    expect(v.chart.series.map((s) => s.label)).toEqual(["Fuel Research", "Excess Inflation"]);
    for (const s of v.chart.series) {
      expect(s.points).toHaveLength(11);
      expect(s.points[0].x).toBe(0);
      expect(s.points[0].value).toBe(v.cash.tail_loss_95);
      expect(s.points.map((p) => p.x)).toEqual([...s.points.map((p) => p.x)].sort((a, b) => a - b));
      for (const p of s.points) expect(p.id).not.toMatch(/\d{4}-\d{2}/);
    }
    expect(v.chart.threshold.value).toBe(v.cash.tail_loss_95);
    expect(v.chart.summary).toMatch(/Cash only/);
  });

  it("labels research money as USD", () => {
    expect(RESEARCH_USD_NOTE).toContain("no conversion rate is assumed");
    expect(v.sentence).not.toMatch(/PLAY/);
  });
});

describe("planView edge cases", () => {
  it.each([
    [NaN, 200],
    [100, Infinity],
    [-1, 200],
    [100, 0],
    [100, -5],
  ])("invalid inputs (%s, %s) suspend the result", (gallons, budget) => {
    const v = planView(art, { gallons, budget });
    expect(v.status).toBe("invalid");
    expect(checkInputs(gallons, budget)).toBeTruthy();
  });

  it("zero exposure favours cash", () => {
    const v = planView(art, { gallons: 0, budget: 200 });
    if (v.status !== "ok") throw new Error();
    expect(v.best.product).toBe("cash");
    expect(v.cashWins && v.zeroExposure).toBe(true);
    expect(v.sentence).toMatch(/keep the illustrative budget as cash/);
  });

  it("very small and larger budgets still produce 21 ranked rows", () => {
    for (const budget of [0.01, 5000]) {
      const v = planView(art, { gallons: 100, budget });
      if (v.status !== "ok") throw new Error();
      expect(v.ranked).toHaveLength(21);
      expect(v.best.stake).toBeLessThanOrEqual(budget);
    }
  });

  it("tie-break: equal TailLoss95 prefers lower stake then cash first", () => {
    const v = planView(art, { gallons: 0, budget: 50 });
    if (v.status !== "ok") throw new Error();
    // All shortfalls are zero; order must be cash, then stake ascending, excess before fuel.
    expect(v.ranked[0].product).toBe("cash");
    expect(v.ranked[1]).toMatchObject({ product: "excess", stake: 5 });
    expect(v.ranked[2]).toMatchObject({ product: "fuel", stake: 5 });
  });
});

describe("offerView", () => {
  const ok = (status: "available" | "not_configured" | "closed" | "unfunded"): CoverOfferSection => ({
    status: "ok",
    data: { seller: { freeCash: "1" }, quote: { p: ["11", "57153"], isSet: true }, status },
  });

  it("available offer exposes the on-chain quote for the product index only", () => {
    const v = offerView(ok("available"), 1, false);
    expect(v.state).toBe("available");
    expect(v.quoteMillionths).toBe("57153");
    expect(v.description).toMatch(/not a chance/);
    expect(v.actionNote).toMatch(/not available/);
  });

  it("distinguishes missing, unfunded, closed, settled and unreadable", () => {
    expect(offerView(ok("not_configured"), 1, false).state).toBe("not_configured");
    expect(offerView(ok("unfunded"), 1, false).state).toBe("unfunded");
    expect(offerView(ok("closed"), 1, false).title).toBe("Offer window closed");
    expect(offerView(ok("closed"), 1, true).title).toBe("Historical session");
    const u = offerView({ status: "unavailable", data: null }, 0, false);
    expect(u.state).toBe("unavailable");
    for (const s of ["not_configured", "unfunded", "closed"] as const)
      expect(offerView(ok(s), 1, false).quoteMillionths).toBeNull();
    expect(u.quoteMillionths).toBeNull();
  });
});
