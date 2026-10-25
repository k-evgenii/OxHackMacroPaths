import { describe, expect, it } from "vitest";
import { PositionsResponse, SessionView } from "@macropaths/client";
import sessionJson from "@macropaths/client/fixtures/session-B89z.view.json";
import positionsJson from "@macropaths/client/fixtures/positions-B89z.view.json";
import {
  buildSeries, capFraction, coverPayout, declineMarkerIndex, gaugeArc, gaugeFraction, projectedPayout, totals,
} from "@/components/charts/series";
import { fixed } from "@/components/charts/_fallback/format";

const s = SessionView.parse(sessionJson);
const pos = PositionsResponse.parse(positionsJson);

describe("path series", () => {
  it("has 48 points and the last point matches the account stats", () => {
    const d = buildSeries(s.path, s.terms.k);
    expect(d).toHaveLength(48);
    expect(s.path[47].peak).toBe(s.stats.peak);
    expect(d[47].peak).toBeCloseTo(9.0597, 6);
    expect(d[47].excess).toBe(s.stats.excessAcc);
    expect(d.reduce((m, p) => (BigInt(p.decline) > m ? BigInt(p.decline) : m), 0n)).toBe(BigInt(s.stats.maxDecline));
  });
  it("excess band is [k, max(value, k)]", () => {
    for (const p of buildSeries(s.path, s.terms.k)) {
      expect(p.excessBand[0]).toBe(4);
      expect(p.excessBand[1]).toBe(Math.max(p.value, 4));
    }
  });
  it("decline marker is the first row whose decline equals max_decline", () => {
    const m = declineMarkerIndex(s.path, s.stats.maxDecline)!;
    expect(s.path[m].decline).toBe("66191");
    expect(s.path.slice(0, m).every((r) => r.decline !== "66191")).toBe(true);
    expect(declineMarkerIndex(s.path, "0")).toBeNull();
  });
});

describe("gauge and budgets", () => {
  it("gauge and cap fractions agree with the scores", () => {
    expect(gaugeFraction(s.scores[0])).toBeCloseTo(0.827387, 9);
    expect(capFraction(s.stats.maxDecline, s.terms.dCap)).toBeCloseTo(0.827387, 6);
    expect(capFraction(s.stats.excessAcc, s.terms.aCap)).toBeCloseTo(0.86398, 6);
    expect(capFraction("900000", "800000")).toBe(1);
    expect(capFraction("5", "0")).toBe(0);
    expect(gaugeArc(0)).toBe("M 10 50 A 40 40 0 0 1 10.000 50.000");
    expect(gaugeArc(1)).toBe("M 10 50 A 40 40 0 0 1 90.000 50.000");
  });
  it("projected payout equals the on-chain payout and leaves no dust for session A", () => {
    const p = pos.positions[0];
    expect(projectedPayout(p.deposited, s).map(String)).toEqual(p.payout);
    expect(totals(pos.positions, s)).toEqual({ deposited: 380000000n, payout: 380000000n, dust: 0n });
  });
  it("cover payout is floor(score*units/1e6) when not yet on chain", () => {
    const c = { address: s.address, owner: s.authority, units: ["1000000", "3"], premiumPaid: ["0", "0"], claimed: false, payout: null } as const;
    expect(coverPayout({ ...c, units: [...c.units], premiumPaid: [...c.premiumPaid] }, s)).toEqual([827387n, 2n]);
  });
  it("formats decimal strings", () => {
    expect(fixed("827387", 4)).toBe("82.7387");
    expect(fixed("863980", 4)).toBe("86.398");
    expect(fixed("-1500", 4)).toBe("-0.15");
    expect(fixed("148929660", 6)).toBe("148.92966");
  });
});
