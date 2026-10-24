// Run: npx tsx --test keeper/src/seller.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampQuote, decimalToMillionths, pricesFromForecast, QUOTE_MAX, QUOTE_MIN } from "./seller.js";

test("clampQuote: V + floor(sigma/2), bounded by 0.05 and 0.95", () => {
  assert.equal(QUOTE_MIN, 50_000n);
  assert.equal(QUOTE_MAX, 950_000n);
  assert.equal(decimalToMillionths("0.40"), 400_000n);
  assert.equal(decimalToMillionths("0.2"), 200_000n);
  assert.equal(decimalToMillionths("0.1234567"), 123_456n);
  assert.equal(clampQuote(400_000n, 200_000n), 500_000n);
  assert.equal(clampQuote(0n, 0n), QUOTE_MIN);
  assert.equal(clampQuote(900_000n, 200_000n), QUOTE_MAX);
});

test("pricesFromForecast: row 0, both products", () => {
  assert.deepEqual(pricesFromForecast([{ V: "0.40", sigma: "0.20" }]), [500_000n, 500_000n]);
  assert.deepEqual(pricesFromForecast({ rows: [{ V: 0.01, sigma: 0 }] }), [QUOTE_MIN, QUOTE_MIN]);
  assert.throws(() => pricesFromForecast([]), /no row 0/);
  assert.throws(() => pricesFromForecast([{ mean: "0.4" }]), /V and sigma/);
});
