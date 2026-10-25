import { afterEach, describe, expect, it, vi } from "vitest";
import vectors from "../../../tests/vectors.json";
import reference from "@macropaths/client/fixtures/session-B89z.view.json";
import {
  FINAL_SCORES,
  X,
  illustrativePayout,
  pathStats,
  toBase,
} from "../../src/demo/lib/demoData";
import { HIST_X, LIVE_START } from "../../src/demo/lib/cpiHistory";
import {
  loadRuns,
  saveRuns,
  loadName,
  saveName,
  type Run,
} from "../../src/demo/lib/history";

afterEach(() => vi.unstubAllGlobals());
const example: Run = {
  id: "run-1",
  at: "2026-10-25T09:00:00Z",
  amounts: [10, 0, 10, 0],
  put: 20,
  back: vectors.worked_example.buyer_total / 1e6,
};
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    },
  });
  return values;
}
describe("demo data stays aligned with program vectors", () => {
  it("uses exactly the reference observations in Play and Explore", () => {
    expect(X).toEqual(reference.path.map((r) => Number(r.value)));
    expect(HIST_X.slice(LIVE_START, LIVE_START + 48)).toEqual(X);
  });
  it("reproduces both terminal statistics and scores", () => {
    const stats = pathStats(X.map((v) => v / 10000));
    expect(stats.D).toBe(vectors.final.D);
    expect(stats.A).toBe(vectors.final.A);
    expect(FINAL_SCORES).toEqual({
      cooling: vectors.final.s1 / 1e6,
      excess: vectors.final.s2 / 1e6,
    });
  });
  it("reproduces the documented 10+10 payout to one PLAY base unit", () => {
    expect(toBase(illustrativePayout([10, 0, 10, 0], FINAL_SCORES))).toBe(
      BigInt(vectors.worked_example.buyer_total),
    );
  });
  it("has no phantom payoff for skipped products", () => {
    expect(illustrativePayout([0, 0, 0, 0], FINAL_SCORES)).toBe(0);
  });
});
describe("local demo persistence", () => {
  it("round-trips the canonical payout", () => {
    storage();
    saveRuns([example]);
    expect(loadRuns()).toEqual([example]);
  });
  it("rejects forged payouts and invalid totals instead of crediting the wallet", () => {
    const values = storage();
    for (const run of [
      { ...example, back: 100000 },
      { ...example, put: 1 },
      { ...example, amounts: [-1, 0, 10, 0] },
      { ...example, amounts: [999, 999, 0, 0] },
    ]) {
      values.set("macropaths.runs.v2", JSON.stringify([run]));
      expect(loadRuns()).toEqual([]);
    }
  });
  it("survives corrupted JSON and unavailable storage", () => {
    const values = storage();
    values.set("macropaths.runs.v2", "{");
    expect(loadRuns()).toEqual([]);
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
    });
    expect(loadRuns()).toEqual([]);
    expect(() => saveRuns([example])).not.toThrow();
  });
  it("keeps only a normalized display name, never credentials", () => {
    const values = storage();
    saveName("  David\u0000   Nkpa  ");
    expect(loadName()).toBe("David Nkpa");
    expect([...values.keys()]).toEqual(["macropaths.name.v2"]);
  });
});
