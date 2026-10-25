import { describe, expect, it } from "vitest";
import { fixed, fmtMillionthsPct, fmtPeriod, fmtPlay, fmtPp, fmtPpMonths, shortAddr } from "@/lib/hooks/format";

describe("format", () => {
  it("formats 1e-4 pp", () => {
    expect(fmtPp("32500")).toBe("3.25%");
    expect(fmtPp("40000", 0)).toBe("4%");
    expect(fmtPp("-66191")).toBe("-6.62%");
    expect(fmtPp(-4n)).toBe("0.00%");
  });
  it("formats pp-months, millionths and PLAY", () => {
    expect(fmtPpMonths("691184")).toBe("69.12 pp-months");
    expect(fmtMillionthsPct("827387")).toBe("82.74%");
    expect(fmtPlay("90000000")).toBe("90.00 PLAY");
    expect(fmtPlay("123456789012345678901", 6)).toBe("123,456,789,012,345.678901 PLAY");
  });
  it("rounds half away from zero exactly", () => {
    expect(fixed("125", 2, 1)).toBe("1.3");
    expect(fixed("-125", 2, 1)).toBe("-1.3");
    expect(fixed("5", 0, 2)).toBe("5");
  });
  it("formats periods and addresses", () => {
    expect(fmtPeriod(202412)).toBe("2024-12");
    expect(shortAddr("B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju")).toBe("B89z...BVju");
  });
});
