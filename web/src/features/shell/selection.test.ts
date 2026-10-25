import referenceSession from "@macropaths/client/fixtures/session-B89z.view.json";
import { describe, expect, it } from "vitest";
import { activeDestination, defaultSelectionHref, destinationHref, resolveSelection, selectHref } from "./selection";

const A = referenceSession.address;
const R = "3UKMQHpTS81vkTh9kaWfnJKqC4NKpAFxtUnmCi4MSdVe";
const catalog = { defaultSession: A, sessions: [{ address: A }, { address: R }] };

describe("resolveSelection", () => {
  const r = (pathname: string, query: string | null, cat = catalog as typeof catalog | undefined, st: "pending" | "error" | "success" = "success") =>
    resolveSelection({ pathname, query, catalog: cat, catalogStatus: st });
  it("loading/unavailable without catalog, never inventing a session", () => {
    expect(resolveSelection({ pathname: "/", query: null, catalog: undefined, catalogStatus: "pending" })).toMatchObject({ address: null, status: "loading" });
    expect(resolveSelection({ pathname: "/", query: null, catalog: undefined, catalogStatus: "error" })).toMatchObject({ address: null, status: "unavailable" });
  });
  it("defaults, query, path precedence, invalid", () => {
    expect(r("/", null)).toMatchObject({ address: A, status: "ready" });
    expect(r("/activity", R)).toMatchObject({ address: R, status: "ready" });
    expect(r(`/session/${R}`, A)).toMatchObject({ address: R });
    expect(r("/", "bogus")).toMatchObject({ address: null, status: "invalid", requested: "bogus" });
  });
});

describe("navigation hrefs", () => {
  it("preserve explicit selection", () => {
    expect(destinationHref("activity", R, A)).toBe(`/activity?session=${R}`);
    expect(destinationHref("activity", A, A)).toBe("/activity");
    expect(destinationHref("session", R, A)).toBe(`/session/${R}`);
    expect(selectHref(`/session/${A}/path`, "", R)).toBe(`/session/${R}/path`);
    expect(selectHref("/products", "x=1", R)).toBe(`/products?x=1&session=${R}`);
    expect(defaultSelectionHref("/products", "session=bad&x=1", A)).toBe("/products?x=1");
  });
  it("active destination", () => {
    expect(activeDestination("/")).toBe("home");
    expect(activeDestination(`/session/${A}/path`)).toBe("session");
    expect(activeDestination("/planner")).toBe("products");
    expect(activeDestination("/dev")).toBeNull();
  });
});
