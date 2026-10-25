import type { Forecast } from "@macropaths/client/types";

export type ForecastProduct = "cooling" | "excess" | "fuel";

/** The stored dispersion describes simulated final scores, not an event probability. */
export function scoreBand(cell: { V: number; sigma: number }) {
  return {
    lower: Math.max(0, cell.V - cell.sigma),
    upper: Math.min(1, cell.V + cell.sigma),
  };
}

export function observedLabel(t: number, start: string): string {
  const [year, month] = start.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + Math.max(0, t - 1)));
  const label = date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return t === 0 ? `Before ${label}` : `Through ${label}`;
}

export function forecastGeometry(
  rows: Forecast["rows"],
  product: ForecastProduct,
  width = 820,
) {
  const left = 45,
    right = Math.max(160, width - 30),
    top = 22,
    bottom = 252;
  const end = rows.at(-1)?.t || 1;
  const point = (t: number, value: number) =>
    `${(left + (t / end) * (right - left)).toFixed(2)},${(bottom - value * (bottom - top)).toFixed(2)}`;
  return {
    line: rows.map((row) => point(row.t, row[product].V)).join(" "),
    band: [
      ...rows.map((row) => point(row.t, scoreBand(row[product]).upper)),
      ...[...rows]
        .reverse()
        .map((row) => point(row.t, scoreBand(row[product]).lower)),
    ].join(" "),
    x: (t: number) => left + (t / end) * (right - left),
    y: (value: number) => bottom - value * (bottom - top),
  };
}
