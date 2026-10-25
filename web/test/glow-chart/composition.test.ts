import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompositionBar } from "../../../packages/ui/src/charts";

describe("CompositionBar zero segments", () => {
  const h = renderToStaticMarkup(createElement(CompositionBar, {
    title: "Side totals",
    segments: [{ label: "A cover", value: 10 }, { label: "B cover", value: 0 }, { label: "A stake", value: 5 }],
    formatValue: (v: number) => `${v} PLAY`,
  }));
  it("draws no bar segment for a zero value", () => {
    expect(h).toContain('data-segment="A cover"');
    expect(h).not.toContain('data-segment="B cover"');
    expect(h).toContain("min-width:0");
  });
  it("labels every segment with text and value, including zero", () => {
    for (const [l, v] of [["A cover", "10 PLAY"], ["B cover", "0 PLAY"], ["A stake", "5 PLAY"]]) {
      expect(h).toContain(l);
      expect(h).toContain(v);
    }
  });
});
