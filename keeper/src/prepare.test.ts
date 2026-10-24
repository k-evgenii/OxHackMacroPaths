// Run: npx tsx --test keeper/src/prepare.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  at,
  floorDiv,
  parseDecimal,
  yoy,
  computeRows,
  pathStats,
  rowsToJson,
  windowDates,
  checkAgainstVectors,
  prepare,
  u32,
  i64,
  u64,
  str,
  periodId,
  datasetId,
  chain,
  walkForward,
  commitmentToVectors,
  replayJson,
  jsonInt,
  type Snapshot,
} from "./prepare.js";

test("floorDiv: mathematical floor (div_euclid for b > 0)", () => {
  const cases: [bigint, bigint, bigint][] = [
    [-1n, 3n, -1n],
    [-3n, 3n, -1n],
    [-4n, 3n, -2n],
    [4n, 3n, 1n],
    [0n, 3n, 0n],
    [3n, 3n, 1n],
    [2n, 3n, 0n],
    [-2n, 3n, -1n],
    [-6n, 3n, -2n],
    [-1_000_000n, 3n, -333_334n],
    // negative divisor: still the floor of the real quotient
    [1n, -3n, -1n],
    [-1n, -3n, 0n],
    [4n, -3n, -2n],
  ];
  for (const [a, b, q] of cases) {
    assert.equal(floorDiv(a, b), q, `floorDiv(${a}, ${b})`);
  }
  assert.throws(() => floorDiv(1n, 0n), RangeError);
});

test("yoy transform: P_{t-12}=3, P_t=2 -> -333334", () => {
  assert.equal(yoy(2n, 3n), -333_334n);
  assert.equal(yoy(3n, 3n), 0n);
  assert.equal(yoy(4n, 3n), 333_333n);
  // 3.25% -> 32500
  assert.equal(yoy(103_250n, 100_000n), 32_500n);
});

test("parseDecimal: exact, plain non-negative decimals only", () => {
  assert.deepEqual(parseDecimal("257.971"), { digits: 257_971n, scale: 3 });
  assert.deepEqual(parseDecimal("9.8"), { digits: 98n, scale: 1 });
  assert.deepEqual(parseDecimal("100"), { digits: 100n, scale: 0 });
  assert.deepEqual(parseDecimal("0.000001"), { digits: 1n, scale: 6 });
  for (const bad of ["", ".", "-1.0", "+1", "1e3", " 1.0", "1.0 ", ".5", "5.", "1,000", "NaN", "0x10"]) {
    assert.throws(() => parseDecimal(bad), Error, JSON.stringify(bad));
  }
});

function synthSnapshot(values: (k: number) => string): Snapshot {
  const rows = [
    { date: "2019-12-01", value_str: "1.0" },
    ...windowDates().map((date, k) => ({ date, value_str: values(k) })),
    { date: "2025-01-01", value_str: "." },
  ];
  return { rows };
}

test("computeRows: mixed decimal scales are aligned exactly", () => {
  // P_{-12..-1} = 100, P_{0..47} = 103.25 (mix "100" with "103.250")
  const snap = synthSnapshot((k) => (k < 12 ? "100" : "103.250"));
  const rows = computeRows(snap);
  assert.equal(rows.length, 48);
  assert.equal(at(rows, 0).date, "2021-01-01");
  assert.equal(at(rows, 47).date, "2024-12-01");
  assert.equal(at(rows, 0).x, 32_500n);
  assert.equal(at(rows, 12).x, 0n);
  assert.deepEqual(rowsToJson(rows.slice(0, 1)), [{ t: 0, date: "2021-01-01", x: 32500 }]);
});

test("computeRows: negative inflation floors toward -infinity", () => {
  // P_{t-12} = 3, P_t = 2 for the first 12 rows
  const snap = synthSnapshot((k) => (k < 12 ? "3" : k < 24 ? "2" : "2.0"));
  const rows = computeRows(snap);
  assert.equal(at(rows, 0).x, -333_334n);
  assert.equal(at(rows, 12).x, 0n);
});

test("window check fails loudly on missing / empty / duplicate months", () => {
  const ok = synthSnapshot(() => "1.5");
  assert.equal(computeRows(ok).length, 48);

  const empty = synthSnapshot((k) => (k === 30 ? "" : "1.5"));
  assert.throws(() => computeRows(empty), /empty value for 2022-07-01/);

  const dot = synthSnapshot((k) => (k === 0 ? "." : "1.5"));
  assert.throws(() => computeRows(dot), /empty value for 2020-01-01/);

  const gap = synthSnapshot(() => "1.5");
  gap.rows = gap.rows.filter((r) => r.date !== "2023-03-01");
  assert.throws(() => computeRows(gap), /missing month: 2023-03-01/);

  const dup = synthSnapshot(() => "1.5");
  dup.rows.push({ date: "2021-06-01", value_str: "1.5" });
  assert.throws(() => computeRows(dup), /duplicate month: 2021-06-01/);

  const bad = synthSnapshot((k) => (k === 5 ? "-1.5" : "1.5"));
  assert.throws(() => computeRows(bad), /not a plain non-negative decimal/);
});

test("pathStats: running peak drawdown and excess accumulator", () => {
  const mk = (xs: bigint[]) => xs.map((x, t) => ({ t, date: "", x }));
  // 2% -> 8% -> 3%: D = 5pp = 50000
  assert.deepEqual(pathStats(mk([20_000n, 80_000n, 30_000n])), { D: 50_000n, A: 40_000n });
  assert.deepEqual(pathStats(mk([-10n, -30n, -20n])), { D: 20n, A: 0n });
});

test("checkAgainstVectors: catches an altered row and levels", () => {
  const snap = synthSnapshot((k) => (k < 12 ? "100" : "103.250"));
  const prep = prepare(snap);
  const vec = {
    rows: rowsToJson(prep.rows),
    levels: prep.levels.map((l) => ({ date: l.date, value_str: l.value_str })),
  };
  assert.deepEqual(checkAgainstVectors(prep, vec), []);
  vec.rows[7] = { ...at(vec.rows, 7), x: at(vec.rows, 7).x + 1 };
  vec.levels[3] = { ...at(vec.levels, 3), value_str: "100.001" };
  const m = checkAgainstVectors(prep, vec);
  assert.equal(m.length, 2);
  assert.match(at(m, 0), /row\[7\].*x vectors=32501 computed=32500/);
  assert.match(at(m, 1), /level\[3\]/);
});

test("checkAgainstVectors: task-5 shape (levels {t,date,level}, final D/A)", () => {
  const snap = synthSnapshot((k) => (k < 12 ? "100" : "103.250"));
  const prep = prepare(snap);
  const { D, A } = pathStats(prep.rows);
  const vec: any = {
    rows: rowsToJson(prep.rows),
    levels: prep.levels.map((l) => ({ t: l.i, date: l.date, level: l.value_str })),
    final: { D: Number(D), A: Number(A) },
  };
  assert.deepEqual(checkAgainstVectors(prep, vec), []);
  vec.levels[0].t = 0;
  vec.levels[1].level = "100.5";
  vec.final.A += 1;
  const m = checkAgainstVectors(prep, vec);
  assert.equal(m.length, 3);
  assert.match(at(m, 0), /level\[0\].*t 0 != -12/);
  assert.match(at(m, 1), /level\[1\].*"100.5"/);
  assert.match(at(m, 2), /final\.A/);
});

// ---------------------------------------------------------------------------
// Commitment chain v1 (docs/commitment-chain.md)

const hex = (b: Buffer) => b.toString("hex");

test("u32: little-endian, bounds and range errors", () => {
  assert.equal(hex(u32(0)), "00000000");
  assert.equal(hex(u32(1)), "01000000");
  assert.equal(hex(u32(202101)), "75150300");
  assert.equal(hex(u32(0x01020304n)), "04030201");
  assert.equal(hex(u32(2n ** 32n - 1n)), "ffffffff");
  assert.throws(() => u32(2n ** 32n), RangeError);
  assert.throws(() => u32(-1), RangeError);
  assert.throws(() => u32(1.5), TypeError);
  assert.throws(() => u32(Number.MAX_SAFE_INTEGER + 1), TypeError);
});

test("i64: two's complement little-endian, bounds and range errors", () => {
  assert.equal(hex(i64(0n)), "0000000000000000");
  assert.equal(hex(i64(-1n)), "ffffffffffffffff");
  assert.equal(hex(i64(-2n)), "feffffffffffffff");
  assert.equal(hex(i64(40_000n)), "409c000000000000");
  assert.equal(hex(i64(-333_334n)), "eae9faffffffffff");
  assert.equal(hex(i64(2n ** 63n - 1n)), "ffffffffffffff7f");
  assert.equal(hex(i64(-(2n ** 63n))), "0000000000000080");
  assert.throws(() => i64(2n ** 63n), RangeError);
  assert.throws(() => i64(-(2n ** 63n) - 1n), RangeError);
});

test("u64: little-endian, bounds and range errors", () => {
  assert.equal(hex(u64(0n)), "0000000000000000");
  assert.equal(hex(u64(800_000n)), "00350c0000000000");
  assert.equal(hex(u64(2n ** 64n - 1n)), "ffffffffffffffff");
  assert.throws(() => u64(2n ** 64n), RangeError);
  assert.throws(() => u64(-1n), RangeError);
});

test("str: u32 byte-length prefix then UTF-8 bytes", () => {
  assert.equal(hex(str("")), "00000000");
  assert.equal(hex(str("CPIAUCNS")), "08000000" + Buffer.from("CPIAUCNS").toString("hex"));
  assert.equal(hex(str("257.971")), "07000000" + "3235372e393731");
  // length is in bytes, not UTF-16 code units: "µ" is 2 bytes
  assert.equal(hex(str("µ")), "02000000c2b5");
});

test("periodId: YYYY-MM-01 -> YYYYMM", () => {
  assert.equal(periodId("2021-01-01"), 202101);
  assert.equal(periodId("2024-12-01"), 202412);
  assert.throws(() => periodId("2021-01-02"));
});

// Expected values computed independently in Python with hashlib and struct.pack.
const SYNTH = {
  params: {
    seriesId: "TEST",
    sourceUrl: "https://example.invalid/x?id=TEST",
    windowStart: "2020-01-01",
    windowEnd: "2020-03-01",
    transformId: "µ-test",
    levels: ["1.0", "2.50", "100"],
    N: 3,
    firstPeriodId: 202001,
    K: -5n,
    D_cap: 2n ** 64n - 1n,
    A_cap: 0n,
  },
  obs: [
    { i: 0, periodId: 202001, value: -1n },
    { i: 1, periodId: 202002, value: 0n },
    { i: 2, periodId: 202003, value: 2n ** 63n - 1n },
  ],
  preimage:
    "0f000000504154482d444154415345542d763104000000544553542100000068747470733a2f2f6578616d706c652e696e76616c69642f783f69643d544553540a000000323032302d30312d30310a000000323032302d30332d303107000000c2b52d746573740300000003000000312e3004000000322e3530030000003130300300000011150300fbffffffffffffffffffffffffffffff0000000000000000",
  datasetId: "6ff42a0043b9d8e9c2e5e44fdab13b8302128cbb4ebfd94ea703fdf2f6384948",
  C: [
    "b63eb69c8421b7e7d68be8eabadcb77c6a061141b3351c7dea0c068d4d172020", // C_0
    "30d73ba81063b89e66d84d5d1cc75d2174c8ddaa545bcc5ce4a57f75978a089b",
    "e8ca8fd9dfada6e03ddc48db11c8ef979e9f5ff63220cbc5b6783f44f99d0f02",
    "671f437bfb6f2bd498e8b4783ba5e038599e0694e84878cf64dfc5dca9771e3d", // C_N
  ],
};

test("datasetId + chain: tiny synthetic chain matches independent Python", () => {
  const { id, preimage } = datasetId(SYNTH.params);
  assert.equal(preimage.length, 161);
  assert.equal(hex(preimage), SYNTH.preimage);
  assert.equal(hex(id), SYNTH.datasetId);
  const r = chain(id, SYNTH.obs);
  assert.deepEqual(r.C.map(hex), SYNTH.C);
  assert.equal(r.endPreimage.length, 47);
  for (const p of r.preimages) assert.equal(p.length, 91);
  assert.equal(walkForward(id, SYNTH.obs, r.C), -1);
  // a wrong value is caught at its own step by the forward walk
  const bad = SYNTH.obs.map((o) => (o.i === 1 ? { ...o, value: 1n } : o));
  assert.equal(walkForward(id, bad, r.C), 1);
  // obs index must equal position
  assert.throws(() => chain(id, [{ i: 1, periodId: 202001, value: 0n }]), /obs\[0\]\.i/);
});

test("jsonInt: numbers below 2^53, decimal strings above", () => {
  assert.equal(jsonInt(40_000n), 40000);
  assert.equal(jsonInt(-1n), -1);
  assert.equal(jsonInt(2n ** 53n - 1n), 9007199254740991);
  assert.equal(jsonInt(2n ** 53n), "9007199254740992");
  assert.equal(jsonInt(2n ** 64n - 1n), "18446744073709551615");
});

function flipHexByte(h: string, byte: number): string {
  const b = Buffer.from(h, "hex");
  b[byte] = (b[byte] ?? 0) ^ 0x01;
  return b.toString("hex");
}

test("checkAgainstVectors: commitment chain, single flipped byte in C_0 and in one C_i", () => {
  const snap = synthSnapshot((k) => (k < 12 ? "100" : "103.250"));
  const prep = prepare(snap);
  const base = () => ({
    rows: rowsToJson(prep.rows),
    levels: prep.levels.map((l) => ({ t: l.i, date: l.date, level: l.value_str })),
    ...structuredClone(commitmentToVectors(prep.commitment)),
  });
  assert.deepEqual(checkAgainstVectors(prep, base(), { requireCommitment: true }), []);
  assert.equal(base().commitment.C_0, at(base().chain, 0).C_i);

  // without a commitment section, the CLI mode reports it
  const none: any = base();
  delete none.commitment;
  delete none.chain;
  assert.deepEqual(checkAgainstVectors(prep, none), []);
  assert.deepEqual(checkAgainstVectors(prep, none, { requireCommitment: true }), [
    "vectors file has no `commitment` section",
    "vectors file has no `chain` array",
  ]);

  const c0 = base();
  c0.commitment.C_0 = flipHexByte(c0.commitment.C_0, 31);
  const m0 = checkAgainstVectors(prep, c0, { requireCommitment: true });
  assert.equal(m0.length, 1);
  assert.match(at(m0, 0), /^commitment\.C_0: /);

  const ci = base();
  at(ci.chain, 17).C_i = flipHexByte(at(ci.chain, 17).C_i, 0);
  const mi = checkAgainstVectors(prep, ci, { requireCommitment: true });
  assert.equal(mi.length, 1);
  assert.match(at(mi, 0), /^chain\[17\]: C_i vectors/);

  const ds = base();
  ds.commitment.dataset_id = flipHexByte(ds.commitment.dataset_id, 5);
  ds.commitment.dataset_preimage_hex = flipHexByte(ds.commitment.dataset_preimage_hex, 100);
  ds.commitment.C_N = flipHexByte(ds.commitment.C_N, 9);
  const md = checkAgainstVectors(prep, ds, { requireCommitment: true });
  assert.equal(md.length, 3);
  assert.match(at(md, 0), /^commitment\.dataset_id: /);
  assert.match(at(md, 1), /^commitment\.dataset_preimage_hex: /);
  assert.match(at(md, 2), /^commitment\.C_N: /);

  // uppercase hex is not byte-for-byte equal to the canonical lowercase form
  const up = base();
  up.commitment.C_0 = up.commitment.C_0.toUpperCase();
  assert.equal(checkAgainstVectors(prep, up, { requireCommitment: true }).length, 1);
});

test("replayJson: rows carry C_i and C_next, chained to C_0 .. C_N", () => {
  const snap = synthSnapshot((k) => (k < 12 ? "100" : "103.250"));
  const prep = prepare(snap);
  const r = replayJson(prep, snap);
  assert.equal(r.N, 48);
  assert.equal(r.first_period_id, 202101);
  assert.equal(r.K, 40000);
  assert.equal(r.D_cap, 80000);
  assert.equal(r.A_cap, 800000);
  assert.equal(r.rows.length, 48);
  assert.equal(r.rows[0].C_i, r.C_0);
  assert.equal(r.rows[47].C_next, r.C_N);
  for (let k = 0; k < 47; k++) assert.equal(r.rows[k].C_next, r.rows[k + 1].C_i);
  assert.equal(r.rows[0].period_id, 202101);
  assert.equal(r.rows[0].value, 32500);
  assert.equal(r.dataset_id, hex(prep.commitment.datasetId));
});
