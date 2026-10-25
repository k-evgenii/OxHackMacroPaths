// Contract test: every frontend v2 scenario fixture parses against its shared schema, and the
// derived fields agree with the shared exact helpers.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { frontendV2Fixtures, scenarios } from "../fixtures/frontend-v2";
import {
  calculateAccruedScores,
  fmtPointMonths,
  fmtPpDifference,
  fmtQuotePlay,
  summarizeHolding,
  sumAmounts,
  SessionView,
} from "../src";
import sessionA from "../fixtures/session-B89z.view.json";
import positionsA from "../fixtures/positions-B89z.view.json";

describe("frontend v2 fixtures", () => {
  for (const [name, { schema, data }] of Object.entries(frontendV2Fixtures)) {
    it(`${name} parses`, () => {
      const r = schema.safeParse(data);
      if (!r.success) throw new Error(`${name}: ${r.error.message}`);
    });
  }

  it("synthetic fixtures are labelled", () => {
    for (const [name, { data }] of Object.entries(frontendV2Fixtures)) {
      if (name === "catalog/reference" || name === "research/bundle" || name === "events/session-a-page") continue;
      expect((data as { _synthetic?: string })._synthetic, name).toMatch(/SYNTHETIC|Reference session A/);
    }
  });

  it("overview derived fields agree with the exact helpers", () => {
    for (const o of Object.values(scenarios.overview)) {
      expect(o.derived.currentScores).toEqual(calculateAccruedScores(o.session));
      expect(o.derived.poolDeposited).toBe(sumAmounts(o.session.sideTotals));
    }
  });

  it("reference session A keeps its real terms and totals", () => {
    const a = SessionView.parse(sessionA);
    expect(a.terms).toEqual({ k: "40000", dCap: "80000", aCap: "800000" });
    expect(a.scores).toEqual(["827387", "863980"]);
    expect(sumAmounts(a.sideTotals)).toBe("380000000");
    expect(scenarios.research.termsMismatchSessionA.sessionTerms).toEqual(a.terms);
    expect(scenarios.research.bundle.metadata.associatedSession).toBeNull();
  });

  it("research bundle hashes are SHA-256 of the committed artifact blobs", () => {
    const b = scenarios.research.bundle;
    for (const [name, file] of [["manifest", "manifest"], ["forecast", "forecast"], ["planner", "planner"]] as const) {
      let bytes: Buffer;
      try {
        bytes = execFileSync("git", ["show", `HEAD:web/public/data/${file}.json`], { cwd: `${__dirname}/../../..` });
      } catch {
        return; // not a git checkout; skip
      }
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(b.metadata.hashes[name]);
    }
  });
});

describe("presentation helpers (foundation smoke)", () => {
  it("sumAmounts is exact beyond 2^53", () => {
    expect(sumAmounts(["9007199254740993", "9007199254740993"])).toBe("18014398509481986");
    expect(sumAmounts([])).toBe("0");
    expect(() => sumAmounts(["1.5"])).toThrow();
  });

  it("session A position: settled payout, unclaimed", () => {
    const h = summarizeHolding(SessionView.parse(sessionA), positionsA.positions[0] as never, null);
    expect(h.position).toMatchObject({ paid: "380000000", amount: "380000000", status: "payout" });
    expect(h.unclaimedTotal).toBe("380000000");
  });

  it("claimed holdings contribute zero; refunding uses premiums/deposits; open is undetermined", () => {
    const w = scenarios.wallet;
    const claimed = w.settledClaimed.holdings[0].read;
    if (claimed.status !== "ok") throw new Error();
    const hc = summarizeHolding(scenarios.sessions.settled, claimed.data.position, claimed.data.cover);
    expect(hc.unclaimedTotal).toBe("0");
    expect(hc.position?.status).toBe("claimed");
    const ref = w.refunding.holdings[0].read;
    if (ref.status !== "ok") throw new Error();
    const hr = summarizeHolding(scenarios.sessions.refunding, ref.data.position, ref.data.cover);
    expect(hr.cover).toMatchObject({ status: "refund", amount: "3848520", maximumPayout: "10000000" });
    expect(hr.position).toMatchObject({ status: "refund", amount: "10000000" });
    const op = w.open.holdings[0].read;
    if (op.status !== "ok") throw new Error();
    const ho = summarizeHolding(scenarios.sessions.open, op.data.position, null);
    expect(ho.position?.status).toBe("undetermined");
    expect(ho.unclaimedTotal).toBeNull();
    expect(summarizeHolding(scenarios.sessions.open, null, null).unclaimedTotal).toBe("0");
  });

  it("running uses accrued scores, not stored zero scores", () => {
    const s = scenarios.sessions.running;
    expect(s.scores).toEqual(["0", "0"]);
    const acc = calculateAccruedScores(s)!;
    expect(acc.every((x) => BigInt(x) > 0n)).toBe(true);
    const r = scenarios.wallet.running.holdings[0].read;
    if (r.status !== "ok") throw new Error();
    const h = summarizeHolding(s, r.data.position, r.data.cover);
    expect(h.position?.status).toBe("illustration");
    expect(h.cover?.status).toBe("illustration");
  });

  it("formatters", () => {
    expect(fmtPpDifference("14000")).toBe("+1.40 pp");
    expect(fmtPpDifference("-2500")).toBe("-0.25 pp");
    expect(fmtPpDifference("0")).toBe("0.00 pp");
    expect(fmtPointMonths("691184")).toBe("69.1 point-months");
    expect(fmtQuotePlay("57153")).toBe("0.057153 PLAY");
  });
});
