import { describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlowLineChart, GlowSparkline } from "../../../packages/ui/src/glow-chart";
import type { GlowLineChartProps, GlowSeries } from "../../../packages/ui/src/glow-chart/types";

const mk = (id: string, vals: Array<number | null>): GlowSeries => ({
  id, label: `Series ${id}`,
  points: vals.map((v, i) => ({ id: `${id}-${i}`, x: i, value: v, label: `Mar 20${10 + i}`, formattedValue: v === null ? "" : `+${v}.1234 pp exact` })),
});
const base: GlowLineChartProps = {
  title: "Observed path", summary: "48 monthly observations, 3 above threshold.",
  series: [mk("a", [1, 2, null, 4, 5])], threshold: { value: 3, label: "Threshold 3.00" },
  xTicks: [{ x: 0, label: "2010" }, { x: 4, label: "2014" }], formatAxisValue: (v) => `${v}%`,
};
const html = (p: Partial<GlowLineChartProps> = {}) => renderToStaticMarkup(createElement(GlowLineChart, { ...base, ...p }));

describe("GlowLineChart markup", () => {
  it("renders accessible title, summary and observation table", () => {
    const h = html();
    expect(h).toContain('aria-label="Observed path"');
    expect(h).toContain("48 monthly observations, 3 above threshold.");
    expect(h).toContain("Not recorded");
    expect(h).toContain("+5.1234 pp exact");
  });
  it("draws crisp 1.5px line plus separate blurred glow and a <=8% fill", () => {
    const h = html();
    expect(h).toContain('stroke-width="1.5"');
    expect(h).toContain("feGaussianBlur");
    expect(h).toMatch(/stop-opacity="0.08"/);
    expect(h).not.toMatch(/stop-opacity="0.(09|1|2)/);
    expect((h.match(/data-role="line"/g) ?? []).length).toBe(2); // null gap splits the line
  });
  it("draws dashed threshold and excess shading", () => {
    const h = html();
    expect(h).toContain('stroke-dasharray="4 4"');
    expect(h).toContain('data-role="excess"');
  });
  it("shows exact supplied tooltip strings for the selected point", () => {
    const h = html({ selectedPointId: "a-3" });
    expect(h).toContain('data-role="bubble"');
    expect(h).toContain("+4.1234 pp exact");
    expect(h).toContain("Mar 2013");
  });
  it("ignores a selection id that is a gap", () => {
    expect(html({ selectedPointId: "a-2" })).not.toContain('data-role="bubble"');
  });
  it("uses unique SVG ids across multiple instances", () => {
    const h = renderToStaticMarkup(createElement(Fragment, null, createElement(GlowLineChart, base), createElement(GlowLineChart, base)));
    const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("hero shows one series; comparison at most two", () => {
    const s = [mk("a", [1, 2]), mk("b", [2, 1]), mk("c", [3, 3])];
    expect(html({ series: s, variant: "hero" })).not.toContain('data-series="b"');
    const c = html({ series: s, variant: "comparison" });
    expect(c).toContain('data-series="b"');
    expect(c).not.toContain('data-series="c"');
  });
  it("handles empty, single-point, flat and negative data without NaN", () => {
    for (const vals of [[], [null], [7], [2, 2, 2], [-3, -8, -1]] as Array<Array<number | null>>) {
      const h = html({ series: [mk("a", vals)] });
      expect(h).not.toContain("NaN");
      expect(h).not.toContain("Infinity");
    }
    expect(html({ series: [] })).toContain("No recorded observations");
  });
  it("disables draw-in under reduced motion", () => {
    expect(html()).toMatch(/prefers-reduced-motion: reduce\)\{\.mpg-chart \.mpg-draw\{animation:none/);
  });
  it("sparkline has no interactive layer", () => {
    const h = renderToStaticMarkup(createElement(GlowSparkline, base));
    expect(h).not.toContain('data-role="hit"');
    expect(h).not.toContain("tabindex");
  });
});
