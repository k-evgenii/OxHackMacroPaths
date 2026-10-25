import { describe, expect, it } from "vitest";
import forecast from "../../public/data/forecast.json";
import manifest from "../../public/data/manifest.json";
import {
  forecastGeometry,
  observedLabel,
  scoreBand,
  type ForecastProduct,
} from "../../src/demo/lib/forecast-model";

describe("forecast research presentation", () => {
  const products: ForecastProduct[] = ["cooling", "excess", "fuel"];
  it("labels the initial and terminal research states without inventing a future period", () => {
    expect(observedLabel(forecast.rows[0].t, manifest.showcase.window[0])).toBe(
      "Before Jan 2021",
    );
    expect(
      observedLabel(forecast.rows.at(-1)!.t, manifest.showcase.window[0]),
    ).toBe("Through Dec 2024");
    expect(forecast.rows.at(-1)!.period_id).toBeNull();
  });
  it("keeps model dispersion inside the score domain and collapses it at the realised endpoint", () => {
    for (const product of products) {
      for (const row of forecast.rows) {
        const band = scoreBand(row[product]);
        expect(band.lower).toBeGreaterThanOrEqual(0);
        expect(band.upper).toBeLessThanOrEqual(1);
        expect(band.lower).toBeLessThanOrEqual(row[product].V);
        expect(band.upper).toBeGreaterThanOrEqual(row[product].V);
      }
      const terminal = forecast.rows.at(-1)![product];
      expect(terminal.sigma).toBe(0);
      expect(terminal.V).toBe(manifest.showcase[product].score / manifest.one);
      expect(scoreBand(terminal).lower).toBe(scoreBand(terminal).upper);
    }
  });
  it("draws one real estimate per artifact row without resampling or fabricating observations", () => {
    for (const product of products) {
      const geometry = forecastGeometry(forecast.rows, product);
      expect(geometry.line.split(" ")).toHaveLength(forecast.rows.length);
      expect(geometry.band.split(" ")).toHaveLength(forecast.rows.length * 2);
      expect(geometry.line).not.toMatch(/NaN|Infinity/);
    }
  });
});
