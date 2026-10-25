// Worker 01 hardening: exact math beyond 2^53, holding-summary state rules, formatters,
// event identity across two sessions in one transaction, and browser-safe module graph.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { scenarios } from "../fixtures/frontend-v2";
import {
  budgets,
  calculateAccruedScores,
  claimAmount,
  coverPayout,
  EventView,
  fmtMillionthsPct,
  fmtPlay,
  fmtPointMonths,
  fmtPp,
  fmtPpDifference,
  fmtPpMonths,
  fmtQuotePlay,
  IDL,
  parseEvents,
  score,
  summarizeHolding,
  sumAmounts,
  type CoverView,
  type PositionView,
  type SessionView,
} from "../src";

type T4 = [string, string, string, string];
type T2 = [string, string];
const BIG = "123456789012345678"; // > 2^53
const base = scenarios.sessions.running;
const sess = (o: Partial<SessionView>): SessionView => ({ ...base, ...o }) as SessionView;
const pos = (deposited: T4, o: Partial<PositionView> = {}): PositionView =>
  ({ address: "P", owner: "O", deposited, claimed: false, payout: null, ...o }) as PositionView;
const cov = (units: T2, premiumPaid: T2, o: Partial<CoverView> = {}): CoverView =>
  ({ address: "C", owner: "O", units, premiumPaid, claimed: false, payout: null, ...o }) as CoverView;

describe("summarizeHolding state rules", () => {
  it("Running: illustration recomputed from accrued scores and temporary budgets, beyond 2^53", () => {
    const s = sess({
      state: "Running",
      nextIndex: 5,
      terms: { k: "40000", dCap: "80000", aCap: "800000" },
      stats: { peak: "50000", maxDecline: "30000", excessAcc: "500000" },
      sideTotals: [BIG, "7", BIG + "0", BIG],
      scores: ["0", "0"],
      pBudget: ["0", "0", "0", "0"],
      rBudget: ["0", "0", "0", "0"],
    });
    const scores = calculateAccruedScores(s)!;
    expect(scores).toEqual([score(30000n, 80000n).toString(), score(500000n, 800000n).toString()]);
    const d: T4 = ["98765432109876543", "3", "1", BIG];
    const totals = s.sideTotals.map(BigInt);
    const b = budgets(totals, scores.map(BigInt));
    const expected = d.reduce((a, x, j) => a + claimAmount(BigInt(x), b.r[j], b.p[j], totals[j]), 0n);
    const units: T2 = [BIG, "9007199254740993"];
    const h = summarizeHolding(s, pos(d), cov(units, ["1", "2"]));
    expect(h.position).toEqual({ paid: sumAmounts(d), amount: expected.toString(), unclaimed: null, status: "illustration" });
    // stored zero budgets would give a different (wrong) illustration
    const fromStored = d.reduce((a, x, j) => a + claimAmount(BigInt(x), 0n, 0n, totals[j]), 0n);
    expect(expected).not.toBe(fromStored);
    expect(h.cover).toEqual({
      paid: "3",
      amount: (
        coverPayout(BigInt(scores[0]), BigInt(units[0])) + coverPayout(BigInt(scores[1]), BigInt(units[1]))
      ).toString(),
      unclaimed: null,
      status: "illustration",
      maximumPayout: (BigInt(BIG) + 9007199254740993n).toString(),
    });
    expect(h.unclaimedTotal).toBeNull();
  });

  it("Running before first observation and Open are undetermined", () => {
    for (const s of [sess({ state: "Running", nextIndex: 0 }), sess({ state: "Open", nextIndex: 0 })]) {
      const h = summarizeHolding(s, pos(["1", "0", "0", "0"]), cov(["5", "6"], ["1", "1"]));
      expect(h.position?.status).toBe("undetermined");
      expect(h.position?.amount).toBeNull();
      expect(h.cover).toMatchObject({ status: "undetermined", amount: null, maximumPayout: "11" });
      expect(h.unclaimedTotal).toBeNull();
      expect(calculateAccruedScores(s)).toBeNull();
    }
  });

  it("Settled uses view payouts exactly; claimed contributes zero; undetermined makes total null", () => {
    const s = sess({ state: "Settled", scores: ["827387", "863980"] });
    const h = summarizeHolding(
      s,
      pos([BIG, "0", "0", "0"], { payout: [BIG, "0", "0", "1"] }),
      cov(["1", "1"], ["1", "1"], { payout: [BIG, BIG] }),
    );
    expect(h.position).toMatchObject({ amount: (BigInt(BIG) + 1n).toString(), status: "payout" });
    expect(h.unclaimedTotal).toBe((3n * BigInt(BIG) + 1n).toString());
    const hc = summarizeHolding(
      s,
      pos(["1", "0", "0", "0"], { payout: ["9", "0", "0", "0"], claimed: true }),
      cov(["1", "1"], ["1", "1"], { payout: ["4", "0"] }),
    );
    expect(hc.position).toEqual({ paid: "1", amount: "9", unclaimed: "0", status: "claimed" });
    expect(hc.unclaimedTotal).toBe("4");
    const hu = summarizeHolding(
      s,
      pos(["1", "0", "0", "0"], { payout: ["9", "0", "0", "0"] }),
      cov(["1", "1"], ["1", "1"], { payout: null }),
    );
    expect(hu.cover?.status).toBe("undetermined");
    expect(hu.unclaimedTotal).toBeNull();
    expect(summarizeHolding(s, null, null)).toEqual({ position: null, cover: null, unclaimedTotal: "0" });
  });

  it("Refunding returns deposits/premiums; claimed refund contributes zero", () => {
    const s = sess({ state: "Refunding" });
    const h = summarizeHolding(s, pos([BIG, "1", "0", "0"]), cov(["100", "200"], [BIG, "5"]));
    expect(h.position).toMatchObject({ amount: (BigInt(BIG) + 1n).toString(), status: "refund" });
    expect(h.cover).toMatchObject({ amount: (BigInt(BIG) + 5n).toString(), status: "refund", maximumPayout: "300" });
    const hc = summarizeHolding(s, pos(["7", "0", "0", "0"], { claimed: true }), null);
    expect(hc.position).toEqual({ paid: "7", amount: "7", unclaimed: "0", status: "claimed" });
    expect(hc.unclaimedTotal).toBe("0");
  });

  it("sumAmounts rejects non-integers", () => {
    for (const bad of ["", "1e3", " 1", "0x10", "1.0"]) expect(() => sumAmounts([bad])).toThrow();
    expect(sumAmounts(["-5", "3"])).toBe("-2");
  });
});

describe("formatters", () => {
  it("distinguish percent, percentage points, point-months and PLAY", () => {
    expect(fmtPp("14000")).toBe("1.40 %");
    expect(fmtMillionthsPct("827387")).toBe("82.7387 %");
    expect(fmtPpDifference("14000")).toBe("+1.40 pp");
    expect(fmtPpMonths("691184")).toBe("69.12 pp·months");
    expect(fmtPointMonths("691184")).toBe("69.1 point-months");
    expect(fmtPlay("148930000")).toBe("148.93 PLAY");
    expect(fmtQuotePlay("57153")).toBe("0.057153 PLAY");
  });
  it("rounding, signs and huge values are exact", () => {
    expect(fmtPpDifference("-49")).toBe("0.00 pp"); // no "-0.00"
    expect(fmtPpDifference("-50")).toBe("-0.01 pp");
    expect(fmtPpDifference(50n)).toBe("+0.01 pp");
    expect(fmtPpDifference("123456789012345678", 0)).toBe("+12,345,678,901,235 pp");
    expect(fmtPointMonths("-691184")).toBe("-69.1 point-months");
    expect(fmtQuotePlay("1000000", 2)).toBe("1.00 PLAY");
    expect(fmtQuotePlay("57153", 9)).toBe("0.057153 PLAY"); // digits clamped to scale
    expect(fmtPlay(BIG)).toBe("123,456,789,012.35 PLAY");
  });
});

// ---- event identity: encode Anchor "Program data:" logs for two sessions in one transaction ----
const disc = (name: string) => (IDL.events ?? []).find((e) => e.name === name)!.discriminator;
const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const pk = (seed: number) => new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (seed * 7 + i) % 256));
function claimedLog(session: PublicKey, owner: PublicKey, a: bigint, b: bigint): string {
  const buf = Buffer.concat([
    Buffer.from(disc("Claimed")),
    session.toBuffer(),
    owner.toBuffer(),
    u64(a),
    u64(b),
    Buffer.from([0]),
  ]);
  return `Program data: ${buf.toString("base64")}`;
}
function coverLog(session: PublicKey, owner: PublicKey): string {
  const buf = Buffer.concat([
    Buffer.from(disc("CoverBought")),
    session.toBuffer(),
    owner.toBuffer(),
    Buffer.from([1]),
    u64(10n),
    u64(3n),
    u64(2n),
  ]);
  return `Program data: ${buf.toString("base64")}`;
}

describe("event identity", () => {
  const pid = IDL.address;
  const [sA, sB, owner] = [pk(1), pk(2), pk(3)];
  const logs = [
    `Program ${pid} invoke [1]`,
    claimedLog(sB, owner, 1n, 2n),
    claimedLog(sA, owner, 18446744073709551615n, 4n),
    coverLog(sB, owner),
    `Program ${pid} success`,
  ];
  const meta = { signature: "sig", slot: 1, blockTime: null };

  it("two sessions in one tx keep emitted session and log-order eventIndex; deterministic", () => {
    const ev = parseEvents(logs, meta);
    expect(ev.map((e) => [e.type, e.session, e.eventIndex])).toEqual([
      ["Claimed", sB.toBase58(), 0],
      ["Claimed", sA.toBase58(), 1],
      ["CoverBought", sB.toBase58(), 2],
    ]);
    expect(ev[1].data).toMatchObject({ amounts: ["18446744073709551615", "4"] });
    expect(parseEvents(logs, meta)).toEqual(ev);
    const onlyA = ev.filter((e) => e.session === sA.toBase58());
    expect(onlyA.map((e) => e.eventIndex)).toEqual([1]); // index survives session filtering
    for (const e of ev) expect(EventView.safeParse(e).success).toBe(true);
  });

  it("every EventView branch requires session and eventIndex", () => {
    const samples = [...scenarios.events.twoSessionsSessionA.events, ...parseEvents(logs, meta)];
    for (const e of samples) {
      const { session: _s, ...noSession } = e;
      const { eventIndex: _i, ...noIndex } = e;
      expect(EventView.safeParse(noSession).success).toBe(false);
      expect(EventView.safeParse(noIndex).success).toBe(false);
      expect(EventView.safeParse({ ...e, eventIndex: -1 }).success).toBe(false);
    }
  });
});

// ---- browser-safe entry modules: transitive runtime imports must avoid decoders/RPC/IDL ----
describe("browser-safe modules", () => {
  const FORBIDDEN = [/^@solana\//, /^@anchor-lang\//, /idl\.json$/, /\/(decode|view|pdas|constants|index)$/, /^node:/];
  function graph(file: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const walk = (f: string) => {
      if (out.has(f)) return;
      const src = readFileSync(f, "utf8");
      const specs = [...src.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gms)]
        .filter((m) => !m[2])
        .map((m) => m[3]);
      out.set(f, specs);
      for (const s of specs) if (s.startsWith(".")) walk(resolve(dirname(f), s) + ".ts");
    };
    walk(file);
    return out;
  }
  for (const entry of ["types", "format", "presentation", "math", "scalars"]) {
    it(`${entry}.ts`, () => {
      const g = graph(resolve(__dirname, `../src/${entry}.ts`));
      for (const [f, specs] of g)
        for (const s of specs) for (const re of FORBIDDEN) expect(re.test(s), `${f} imports ${s}`).toBe(false);
    });
  }
});
