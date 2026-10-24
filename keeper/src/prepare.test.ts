// Run: npx tsx --test keeper/src/prepare.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  floorDiv,
  parseDecimal,
  yoy,
  computeRows,
  pathStats,
  rowsToJson,
  windowDates,
  checkAgainstVectors,
  prepare,
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
    assert.throws(() => parseDecimal(bad), undefined, JSON.stringify(bad));
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
  assert.equal(rows[0].date, "2021-01-01");
  assert.equal(rows[47].date, "2024-12-01");
  assert.equal(rows[0].x, 32_500n);
  assert.equal(rows[12].x, 0n);
  assert.deepEqual(rowsToJson(rows.slice(0, 1)), [{ t: 0, date: "2021-01-01", x: 32500 }]);
});

test("computeRows: negative inflation floors toward -infinity", () => {
  // P_{t-12} = 3, P_t = 2 for the first 12 rows
  const snap = synthSnapshot((k) => (k < 12 ? "3" : k < 24 ? "2" : "2.0"));
  const rows = computeRows(snap);
  assert.equal(rows[0].x, -333_334n);
  assert.equal(rows[12].x, 0n);
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
  vec.rows[7] = { ...vec.rows[7], x: vec.rows[7].x + 1 };
  vec.levels[3] = { ...vec.levels[3], value_str: "100.001" };
  const m = checkAgainstVectors(prep, vec);
  assert.equal(m.length, 2);
  assert.match(m[0], /row\[7\].*x vectors=32501 computed=32500/);
  assert.match(m[1], /level\[3\]/);
});
