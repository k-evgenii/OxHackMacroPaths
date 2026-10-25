import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlowLineChart } from "../../../packages/ui/src/glow-chart";
import type { GlowLineChartProps } from "../../../packages/ui/src/glow-chart/types";

const pts = [1, 5, 2, 6, 3].map((v, i) => ({ id: `p${i}`, x: i, value: v, label: `Month ${i}`, formattedValue: `${v}.00 pp` }));
const base: GlowLineChartProps = {
  title: "Path", summary: "Five readings.", series: [{ id: "a", label: "A", points: pts }],
  threshold: { value: 4, label: "Threshold 4%" }, formatAxisValue: (v) => `${v}`,
};
const html = (p: Partial<GlowLineChartProps>) => renderToStaticMarkup(createElement(GlowLineChart, { ...base, ...p }));
const lineD = (h: string) => h.match(/<path d="([^"]+)"[^>]*data-role="line"/)![1];

describe("progressive reveal", () => {
  it("draws only up to the reveal point; hidden points are absent, not zeroed", () => {
    const full = lineD(html({}));
    const part = lineD(html({ revealUpToPointId: "p2" }));
    expect(part.split("C")).toHaveLength(3); // M + 2 segments
    expect(full.startsWith(part.split("C")[0])).toBe(true); // same scale, no rescale
    expect(part).not.toMatch(/,0C|,0$/);
  });
  it("null / unknown id shows everything", () => {
    expect(lineD(html({ revealUpToPointId: null }))).toBe(lineD(html({})));
    expect(lineD(html({ revealUpToPointId: "nope" }))).toBe(lineD(html({})));
  });
  it("selection follows the reveal point; hidden points cannot be selected", () => {
    expect(html({ revealUpToPointId: "p2", selectedPointId: "p2" })).toContain('data-role="bubble"');
    expect(html({ revealUpToPointId: "p2", selectedPointId: "p4" })).not.toContain('data-role="bubble"');
  });
});

describe("threshold band label", () => {
  const h = html({ threshold: { value: 4, label: "Threshold 4%", bandLabel: "69.1 point-months above 4%" } });
  it("renders supplied text as an annotation", () => {
    expect(h).toMatch(/data-role="band-label"[^>]*>69.1 point-months above 4%</);
  });
  it("is in the screen-reader summary and data table", () => {
    expect(h).toContain("Five readings. Threshold 4%: 69.1 point-months above 4%");
    expect(h).toContain("<caption>Threshold 4%: 69.1 point-months above 4%</caption>");
  });
  it("is absent when not supplied", () => {
    expect(html({})).not.toContain("band-label");
  });
});
