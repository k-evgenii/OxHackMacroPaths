// Research caps (manifest p90) and research scores are a different parameterisation from a session's terms.
// Every place the UI shows one must say "research p90 cap" / "research illustration" and, with a session in
// context, show the session's own cap (8 pp / 80 pp·mo for the reference session) beside it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionView } from "@macropaths/client";
import sessionFixture from "@macropaths/client/fixtures/session-B89z.view.json";
import { Forecast, Manifest } from "@/lib/artifacts";
import { ProductCard } from "@/app/forecast/product-card";
import { ProductsList } from "@/components/shell/Overview";
import { fmtCap, ResearchCap, researchCap, sessionCap, sessionTermsText } from "@/components/shell/ResearchCaps";

const load = (name: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../public/data", `${name}.json`), "utf8"));
const manifest = Manifest.parse(load("manifest"));
const forecast = Forecast.parse(load("forecast"));
const session = SessionView.parse(sessionFixture);
const product = (key: string) => manifest.products.find((p) => p.key === key)!;
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&middot;|&#xB7;/g, "·");

describe("cap formatting", () => {
  it("drops trailing zeros and names the unit", () => {
    expect(fmtCap("80000", "pp")).toBe("8 pp");
    expect(fmtCap("800000", "pp·mo")).toBe("80 pp·mo");
    expect(fmtCap(76973, "pp")).toBe("7.6973 pp");
    expect(fmtCap(1883141, "pp·mo")).toBe("188.3141 pp·mo");
  });
  it("reads the research cap from the manifest and the session cap from the session terms", () => {
    expect(researchCap(product("cooling"))).toBe("7.6973 pp");
    expect(researchCap(product("excess"))).toBe("188.3141 pp·mo");
    expect(researchCap(product("fuel"))).toBe("3.6411 usd·mo");
    expect(sessionCap(product("cooling"), session)).toBe("8 pp");
    expect(sessionCap(product("excess"), session)).toBe("80 pp·mo");
    expect(sessionCap(product("fuel"), session)).toBeNull();
    expect(sessionTermsText(session)).toBe("session B89z...BVju (k 4 pp, d_cap 8 pp, a_cap 80 pp·mo) scored 82.74% / 86.40% against its own terms");
  });
});

describe("ResearchCap", () => {
  it("labels the research cap and shows the session cap beside it when a session is given", () => {
    const html = render(createElement(ResearchCap, { p: product("cooling"), session }));
    expect(html).toContain("research p90 cap 7.6973 pp");
    expect(html).toContain("session B89z...BVju cap 8 pp");
  });
  it("shows only the research cap without a session, and says a research product has no on-chain cap", () => {
    const html = render(createElement(ResearchCap, { p: product("cooling") }));
    expect(html).toContain("research p90 cap 7.6973 pp");
    expect(html).not.toContain("8 pp");
    expect(render(createElement(ResearchCap, { p: product("fuel"), session }))).toContain("no on-chain cap");
  });
});

describe("Forecast product card", () => {
  const showcase = manifest.showcase.cooling;
  it("names the research p90 cap and the research illustration, with the session cap beside it", () => {
    const html = render(createElement(ProductCard, { p: product("cooling"), f: forecast, showcase, session }));
    expect(html).toContain("research p90 cap");
    expect(html).toContain("research illustration");
    expect(html).toContain("session B89z...BVju cap 8 pp");
  });
  it("still labels the research cap when no session is in context", () => {
    const html = render(createElement(ProductCard, { p: product("cooling"), f: forecast, showcase }));
    expect(html).toContain("research p90 cap");
    expect(html).not.toContain("8 pp");
  });
});

describe("Overview products list", () => {
  it("shows research p90 caps with the session cap beside each on-chain product", () => {
    const html = render(createElement(ProductsList, { manifest, forecast, session }));
    expect(html).toContain("research p90 cap 7.6973 pp");
    expect(html).toContain("session B89z...BVju cap 8 pp");
    expect(html).toContain("session B89z...BVju cap 80 pp·mo");
  });
});
