import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DISCRIMINATORS,
  EventsResponse,
  PROGRAM_ID,
  PositionsResponse,
  SessionView,
  accountKind,
  budgets,
  claimAmount,
  coverPayout,
  coverPda,
  decodeAccount,
  fmtMillionthsPct,
  fmtPeriod,
  fmtPlay,
  fmtPp,
  fmtPpMonths,
  parseEvents,
  positionPda,
  quotePda,
  recomputePath,
  score,
  sellerPda,
  sellerTaPda,
  sessionPda,
  toPositionView,
  toSessionView,
  vaultPda,
} from "../src/index";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const json = (p: string) => JSON.parse(readFileSync(root(p), "utf8"));
const b64 = (s: string) => new Uint8Array(Buffer.from(s.trim(), "base64"));

const ADDR = "B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju";
const sessionBytes = b64(readFileSync(root("fixtures/session-B89z.base64"), "utf8"));
const sessionFixture = json("fixtures/session-B89z.view.json");
const view = toSessionView(ADDR, sessionBytes);
const vectors = json("../../tests/vectors.json");

describe("decode", () => {
  it("session account reproduces session-B89z.view.json", () => {
    expect(view).toEqual(sessionFixture);
    expect(SessionView.parse(view)).toEqual(view);
    expect(view.path).toHaveLength(view.nextIndex);
  });

  it("accountKind and decodeAccount", () => {
    expect(accountKind(sessionBytes)).toBe("Session");
    expect(accountKind(new Uint8Array(4))).toBeNull();
    expect(accountKind(new Uint8Array(16))).toBeNull();
    expect(() => decodeAccount("Position", sessionBytes)).toThrow();
    const raw = decodeAccount<{ next_index: number }>("Session", sessionBytes);
    expect(raw.next_index).toBe(48);
    expect(Object.keys(ACCOUNT_DISCRIMINATORS).sort()).toEqual(["Cover", "EntryQuote", "Position", "Seller", "Session"]);
  });

  it("positions reproduce positions-B89z.view.json", () => {
    const children: { address: string; kind: string; base64: string }[] = json("fixtures/children-B89z.raw.json");
    const positions = children
      .filter((c) => c.kind === "Position")
      .map((c) => toPositionView(c.address, b64(c.base64), view));
    const resp = { positions, covers: [] };
    expect(resp).toEqual(json("fixtures/positions-B89z.view.json"));
    PositionsResponse.parse(resp);
  });

  it("parseEvents reproduces events-B89z.view.json", () => {
    const txs: { signature: string; slot: number; blockTime: number | null; logs: string[] }[] = json(
      "fixtures/txlogs-B89z.raw.json",
    );
    const events = txs.flatMap(({ logs, ...meta }) => parseEvents(logs, meta));
    const resp = { events, nextBefore: null, pending: [], retryCursor: null };
    expect(resp).toEqual(json("fixtures/events-B89z.view.json"));
    EventsResponse.parse(resp);
  });
});

describe("math", () => {
  const xs: bigint[] = vectors.rows.map((r: { x: number }) => BigInt(r.x));
  const k = BigInt(vectors.parameters.K);

  it("recomputePath reproduces vectors.running and the account stats", () => {
    const rows = recomputePath(xs, k, 202412);
    rows.forEach((row, t) => {
      const v = vectors.running[t];
      expect([row.peak, row.decline, row.excess]).toEqual([String(v.M), String(v.D), String(v.A)]);
    });
    expect(rows[0].periodId).toBe(202101);
    expect(rows[11].periodId).toBe(202112);
    const last = rows[rows.length - 1];
    expect(last.peak).toBe(view.stats.peak);
    expect(last.decline).toBe(view.stats.maxDecline);
    expect(last.excess).toBe(view.stats.excessAcc);
  });

  it("scores reproduce vectors.final and the annual slices", () => {
    const { Dcap, Acap, Acap_cap40 } = vectors.parameters;
    const f = vectors.final;
    expect(score(BigInt(f.D), BigInt(Dcap))).toBe(BigInt(f.s1));
    expect(score(BigInt(f.A), BigInt(Acap))).toBe(BigInt(f.s2));
    expect(score(BigInt(f.A), BigInt(Acap_cap40))).toBe(BigInt(f.s2_cap40));
    expect(score(-1n, 10n)).toBe(0n);
    expect(() => score(1n, 0n)).toThrow();
    for (const y of vectors.annual_slices.years) {
      const rows = recomputePath(xs.slice(y.t_first, y.t_last + 1), k, y.year * 100 + 12);
      const last = rows[rows.length - 1];
      expect([last.peak, last.decline, last.excess]).toEqual([String(y.M), String(y.D), String(y.A)]);
      expect(score(BigInt(y.D), BigInt(Dcap))).toBe(BigInt(y.s1));
      expect(score(BigInt(y.A), BigInt(Acap))).toBe(BigInt(y.s2));
    }
  });

  it("synthetic paths", () => {
    const syn = vectors.synthetic;
    for (const c of [syn.same_endpoint_pair.spike, syn.same_endpoint_pair.flat, syn.through_zero]) {
      const rows = recomputePath(c.x.map(BigInt), k, 202103);
      const last = rows[rows.length - 1];
      expect([last.peak, last.decline, last.excess]).toEqual([String(c.M), String(c.D), String(c.A)]);
      expect(score(BigInt(c.D), BigInt(vectors.parameters.Dcap))).toBe(BigInt(c.s1));
    }
    for (const c of vectors.threshold.cases) {
      expect(recomputePath([BigInt(c.x)], k, 202101)[0].excess).toBe(String(c.A_added));
    }
  });

  it("budget_3v2 and worked_example", () => {
    const b = vectors.budget_3v2;
    const got = budgets([BigInt(b.S[0]), BigInt(b.S[1]), 0n, 0n], [BigInt(b.s), 0n]);
    expect(got.matched[0]).toBe(BigInt(b.M));
    expect(got.p.slice(0, 2)).toEqual(b.P.map(BigInt));
    expect(got.r.slice(0, 2)).toEqual(b.R.map(BigInt));
    b.deposits.forEach((side: number[], j: number) =>
      side.forEach((a, u) =>
        expect(claimAmount(BigInt(a), got.r[j], got.p[j], BigInt(b.S[j]))).toBe(BigInt(b.claims[j][u])),
      ),
    );
    const w = vectors.worked_example;
    let total = 0n;
    for (const prod of [w.cooling, w.excess]) {
      const g = budgets(prod.S.map(BigInt).concat([0n, 0n]), [BigInt(prod.s), 0n]);
      expect(g.p.slice(0, 2)).toEqual(prod.P.map(BigInt));
      const c = claimAmount(BigInt(w.buyer_deposit), g.r[0], g.p[0], BigInt(prod.S[0]));
      expect(c).toBe(BigInt(prod.buyer_claim));
      total += c;
    }
    expect(total).toBe(BigInt(w.buyer_total));
    expect(claimAmount(5n, 1n, 1n, 0n)).toBe(0n);
  });

  it("budgets reproduce the Settled event from side totals and scores", () => {
    const settled = json("fixtures/events-B89z.view.json").events.find((e: { type: string }) => e.type === "Settled");
    const got = budgets(view.sideTotals.map(BigInt), settled.data.scores.map(BigInt));
    expect(got.matched.map(String)).toEqual(settled.data.matched);
    expect(got.p.map(String)).toEqual(settled.data.pBudget);
    expect(got.r.map(String)).toEqual(settled.data.rBudget);
  });

  it("coverPayout floors", () => {
    expect(coverPayout(827387n, 1_000_000n)).toBe(827387n);
    expect(coverPayout(999_999n, 1n)).toBe(0n);
  });
});

describe("pdas", () => {
  const session = new PublicKey(ADDR);
  const owner = new PublicKey(view.authority);
  const keeper = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);

  it("session and vaults match the account", () => {
    expect(sessionPda(owner, BigInt(view.sessionId))[0].toBase58()).toBe(ADDR);
    expect([vaultPda(session, 0)[0].toBase58(), vaultPda(session, 1)[0].toBase58()]).toEqual(view.vaults);
  });

  it("position matches the fixture child", () => {
    const child = json("fixtures/children-B89z.raw.json")[0];
    expect(positionPda(session, owner)[0].toBase58()).toBe(child.address);
  });

  it("match the keeper's seed layouts", () => {
    const s = session.toBuffer();
    expect(sellerPda(session)).toEqual(keeper([Buffer.from("seller"), s]));
    expect(sellerTaPda(session)).toEqual(keeper([Buffer.from("seller_ta"), s]));
    expect(quotePda(session)).toEqual(keeper([Buffer.from("quote"), s]));
    expect(coverPda(session, owner)).toEqual(keeper([Buffer.from("cover"), s, owner.toBuffer()]));
  });
});

describe("format", () => {
  it("renders display strings", () => {
    expect(fmtPp("13997")).toBe("1.40 %");
    expect(fmtPp(13997n, 4)).toBe("1.3997 %");
    expect(fmtPp("-5000", 1)).toBe("-0.5 %");
    expect(fmtPp("-4", 2)).toBe("0.00 %");
    expect(fmtPpMonths("691184")).toBe("69.12 pp·months");
    expect(fmtMillionthsPct("827387")).toBe("82.7387 %");
    expect(fmtMillionthsPct("1000000", 0)).toBe("100 %");
    expect(fmtPlay("148929660")).toBe("148.93 PLAY");
    expect(fmtPlay("1234567890000", 0)).toBe("1,234,568 PLAY");
    expect(fmtPeriod(202101)).toBe("Jan 2021");
    expect(fmtPeriod(202412)).toBe("Dec 2024");
  });
});
