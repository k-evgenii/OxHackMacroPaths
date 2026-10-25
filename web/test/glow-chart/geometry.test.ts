import { describe, expect, it } from "vitest";
import {
  areaPath, clampBubble, makeScale, monotonePath, nearestPoint, segments, stepSelection, xDomain, yDomain, yTicks, type Located,
} from "../../../packages/ui/src/glow-chart/geometry";
import type { GlowPoint, GlowSeries } from "../../../packages/ui/src/glow-chart/types";

const pt = (i: number, v: number | null): GlowPoint => ({ id: `m${i}`, x: i, value: v, label: `Month ${i}`, formattedValue: v === null ? "" : `${v}.00 pp` });
const ser = (vals: Array<number | null>): GlowSeries => ({ id: "s", label: "Path", points: vals.map((v, i) => pt(i, v)) });

/** Sample every cubic segment of an "M..C..C.." path. */
function sample(d: string): Array<{ x: number; y: number; seg: number; a: number; b: number }> {
  const nums = d.replace(/^M/, "").split("C").map((c) => c.split(",").map(Number));
  let [x0, y0] = nums[0];
  const out: Array<{ x: number; y: number; seg: number; a: number; b: number }> = [];
  for (let s = 1; s < nums.length; s++) {
    const [x1, y1, x2, y2, x3, y3] = nums[s];
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const u = 1 - t;
      out.push({
        x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        seg: s, a: y0, b: y3,
      });
    }
    x0 = x3;
    y0 = y3;
  }
  return out;
}

describe("domain", () => {
  it("handles empty data", () => {
    expect(yDomain([])).toEqual([0, 1]);
    expect(yDomain([ser([null, null])])).toEqual([0, 1]);
    expect(xDomain([])).toEqual([0, 1]);
  });
  it("handles single point and flat data with a non-zero span", () => {
    const [a, b] = yDomain([ser([5])]);
    expect(a).toBeLessThan(5);
    expect(b).toBeGreaterThan(5);
    const [c, d] = yDomain([ser([0, 0, 0])]);
    expect(d - c).toBeGreaterThan(0);
    const [e, f] = xDomain([ser([3])]);
    expect(f - e).toBeGreaterThan(0);
  });
  it("handles negative data", () => {
    const [a, b] = yDomain([ser([-4, -2, -9])]);
    expect(a).toBeLessThan(-9);
    expect(b).toBeGreaterThan(-2);
  });
  it("includes a threshold outside the observed range", () => {
    const [, b] = yDomain([ser([1, 2, 3])], { value: 10 });
    expect(b).toBeGreaterThanOrEqual(10);
  });
  it("yields 1-5 ticks inside the domain", () => {
    for (const dom of [[0, 1], [-3.2, 7.9], [100, 100.4]] as Array<[number, number]>) {
      const t = yTicks(dom);
      expect(t.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeLessThanOrEqual(5);
      for (const v of t) expect(v >= dom[0] - 1e-9 && v <= dom[1] + 1e-9).toBe(true);
    }
  });
});

describe("segments", () => {
  it("breaks on null gaps and never bridges them", () => {
    const segs = segments(ser([1, 2, null, null, 3, 4, null, 5]).points);
    expect(segs.map((s) => s.map((p) => p.id))).toEqual([["m0", "m1"], ["m4", "m5"], ["m7"]]);
  });
  it("keeps trailing unrecorded months empty", () => {
    const segs = segments(ser([1, 2, 3, null, null]).points);
    expect(segs).toHaveLength(1);
    expect(segs[0].at(-1)!.id).toBe("m2");
  });
});

describe("monotone path", () => {
  const cases: number[][] = [
    [0, 10, 0, 10, 0],
    [1, 1, 1, 9, 9, 9],
    [0, 0.1, 50, 50.1, 0],
    [5, 3, 3.1, -7, 12, 12, 11],
  ];
  it("passes through every point", () => {
    const pts = [0, 10, 3, 7].map((y, i) => ({ x: i * 10, y }));
    const d = monotonePath(pts);
    for (const p of pts) expect(d).toContain(`${p.x},${p.y}`);
  });
  it.each(cases)("does not overshoot adjacent extrema %#", (...ys) => {
    const pts = ys.map((y, i) => ({ x: i * 20, y }));
    for (const s of sample(monotonePath(pts))) {
      expect(s.y).toBeGreaterThanOrEqual(Math.min(s.a, s.b) - 1e-6);
      expect(s.y).toBeLessThanOrEqual(Math.max(s.a, s.b) + 1e-6);
    }
  });
  it("handles 0, 1 and 2 points", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 1, y: 2 }])).toBe("M1,2");
    expect(monotonePath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toMatch(/^M0,0C/);
    expect(areaPath([{ x: 0, y: 0 }], 5)).toBe("");
  });
});

describe("selection", () => {
  const sx = makeScale([0, 4], [0, 400]);
  const located: Located[] = ser([1, null, 3, 4, 5]).points
    .filter((p) => p.value !== null)
    .map((p) => ({ seriesId: "s", point: p, px: sx(p.x), py: 0 }));

  it("pointer selects the nearest actual point, never a gap", () => {
    expect(nearestPoint(located, 90)!.point.id).toBe("m0");
    expect(nearestPoint(located, 160)!.point.id).toBe("m2");
    expect(nearestPoint(located, 9999)!.point.id).toBe("m4");
    expect(nearestPoint([], 5)).toBeNull();
  });
  it("returns the exact supplied strings", () => {
    const hit = nearestPoint(located, 310)!;
    expect(hit.point.formattedValue).toBe("4.00 pp");
    expect(hit.point.label).toBe("Month 3");
  });
  it("keyboard steps among observations", () => {
    expect(stepSelection(located, null, "ArrowRight")!.point.id).toBe("m0");
    expect(stepSelection(located, "m0", "ArrowRight")!.point.id).toBe("m2");
    expect(stepSelection(located, "m4", "ArrowRight")!.point.id).toBe("m4");
    expect(stepSelection(located, "m2", "ArrowLeft")!.point.id).toBe("m0");
    expect(stepSelection(located, "m2", "End")!.point.id).toBe("m4");
    expect(stepSelection(located, "m3", "Home")!.point.id).toBe("m0");
    expect(stepSelection([], null, "ArrowRight")).toBeNull();
  });
});

describe("tooltip bounds", () => {
  it.each([375, 320, 1200])("stays inside a %ipx container at both edges", (w) => {
    for (const anchor of [0, 5, w / 2, w - 3, w]) {
      for (const bw of [60, 180, 600]) {
        const left = clampBubble(anchor, bw, w);
        const eff = Math.min(bw, w - 8);
        expect(left).toBeGreaterThanOrEqual(4);
        expect(left + eff).toBeLessThanOrEqual(w - 4 + 1e-9);
      }
    }
  });
});
