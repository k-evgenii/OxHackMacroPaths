import { describe, expect, it } from "vitest";
import raw from "../../public/data/planner.json";
import { PlannerArtifact } from "@/lib/artifacts";
import { policies, recommend, showcase } from "@/lib/planner";

const art = PlannerArtifact.parse(raw);
const { q, B } = art.defaults;
const COLS = ["stake", "units", "tail_loss_95", "mean_shortfall", "max_shortfall", "cap_binding_freq", "expected_end_cash"] as const;
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-6);

describe("planner port vs planner.json", () => {
  const { best, ranked } = recommend(art.scenarios, q, B, art.prices);

  it("produces 21 policies", () => {
    expect(policies(B)).toHaveLength(21);
    expect(ranked).toHaveLength(21);
  });

  it("default table matches row by row to 1e-6", () => {
    expect(art.default_table).toHaveLength(21);
    ranked.forEach((r, i) => {
      const e = art.default_table[i];
      expect(r.product).toBe(e.product);
      for (const c of COLS) close(r[c], e[c]);
    });
  });

  it("recommendation matches default_recommendation", () => {
    expect(best.product).toBe(art.default_recommendation.product);
    for (const c of COLS) close(best[c], art.default_recommendation[c]);
  });

  it("showcase matches showcase.under_recommended", () => {
    const s = showcase(best, art.showcase, q, B, art.prices);
    for (const [k, v] of Object.entries(art.showcase.under_recommended) as [keyof typeof s, number][]) close(s[k], v);
  });
});

describe("re-ranking at q=250, B=80", () => {
  // Produced once by running research/planner.py recommend(scenarios, 250.0, 80.0, prices) on
  // forecast/planner.json (python -I); (product, stake, TailLoss95 rounded to 9 dp), in ranked order.
  const EXPECTED: [string, number, number][] = [
    ["fuel", 80, 417.116686796], ["fuel", 72, 482.872518116], ["fuel", 64, 548.628349437],
    ["fuel", 56, 614.384180757], ["fuel", 48, 680.140012078], ["fuel", 40, 745.895843398],
    ["fuel", 32, 811.651674718], ["fuel", 24, 877.407506039], ["fuel", 16, 943.163337359],
    ["fuel", 8, 1008.91916868], ["cash", 0, 1074.675], ["excess", 8, 1082.675], ["excess", 16, 1090.675],
    ["excess", 24, 1098.675], ["excess", 32, 1106.675], ["excess", 40, 1114.675], ["excess", 48, 1122.675],
    ["excess", 56, 1130.675], ["excess", 64, 1138.675], ["excess", 72, 1146.675], ["excess", 80, 1154.675],
  ];
  // Full top row from the same run.
  const TOP = {
    units: 737.5583132041377, tail_loss_95: 417.1166867958623, mean_shortfall: 61.048567495921105,
    max_shortfall: 468.4666867958622, cap_binding_freq: 0.10062893081761007, expected_end_cash: 191.2759608059656,
  };

  it("ranks in the same order with the same TailLoss95", () => {
    const { best, ranked } = recommend(art.scenarios, 250, 80, art.prices);
    ranked.forEach((r, i) => {
      expect(r.product).toBe(EXPECTED[i][0]);
      close(r.stake, EXPECTED[i][1]);
      close(r.tail_loss_95, EXPECTED[i][2]);
    });
    for (const [k, v] of Object.entries(TOP)) close(best[k as keyof typeof TOP], v);
  });
});
