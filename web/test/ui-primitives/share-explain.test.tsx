import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShareBar, shareBps, formatBps } from "../../../packages/ui/src/data";
import { Explain } from "../../../packages/ui/src/dialog";
import { SIDE_LABELS, sideSegments, totalLocked, type SessionLike } from "../../../packages/ui/src/session";

describe("shareBps", () => {
  it("is exact for huge bigints and zero-safe", () => {
    const big = 10n ** 30n;
    expect(shareBps(big, big * 4n)).toBe(2500);
    expect(shareBps(0n, 0n)).toBe(0);
    expect(shareBps(5n, 0n)).toBe(0);
    expect(formatBps(2500)).toBe("25.00%");
    expect(formatBps(7)).toBe("0.07%");
  });
});

describe("ShareBar", () => {
  const seg = (label: string, value: bigint) => ({ label, value, formattedValue: `${value} base` });
  it("gives zero segments no width but still lists them with values", () => {
    const out = renderToStaticMarkup(<ShareBar title="Pool" segments={[seg("A · More", 3n), seg("A · Less", 0n), seg("B · More", 1n)]} />);
    expect(out.match(/mp-share__seg mp-share__seg/g)).toHaveLength(2);
    expect(out).toContain("width:75%");
    expect(out).toContain("A · Less");
    expect(out).toContain("0 base · 0.00%");
  });
  it("renders a truthful empty state when everything is zero", () => {
    const out = renderToStaticMarkup(<ShareBar title="Pool" segments={[seg("A", 0n), seg("B", 0n)]} />);
    expect(out).toContain("Nothing deposited yet");
    expect(out).not.toContain("width:");
    expect(out).not.toContain("%");
  });
});

describe("session side helpers", () => {
  it("uses approved side names and exact bigint totals", () => {
    expect(SIDE_LABELS).toEqual(["More", "Less"]);
    const s = { sideTotals: ["9007199254740993", 1n, 0, { toString: () => "2" }] } as unknown as SessionLike;
    const segs = sideSegments(s);
    expect(segs[0].value).toBe(9007199254740993n);
    expect(segs[1].label).toMatch(/· Less$/);
    expect(totalLocked(s)).toBe(9007199254740996n);
  });
});

describe("Explain", () => {
  it("renders a named, collapsed 44px trigger controlling a hidden panel", () => {
    const out = renderToStaticMarkup(
      <Explain label="Explain residual shortfall" title="Residual shortfall">
        Caller-supplied text.
      </Explain>,
    );
    expect(out).toContain('aria-label="Explain residual shortfall"');
    expect(out).toContain('aria-expanded="false"');
    const controls = out.match(/aria-controls="([^"]+)"/)![1];
    expect(out).toContain(`id="${controls}"`);
    expect(out).toContain("hidden");
    expect(out).toContain('type="button"');
    expect(out).toContain("Caller-supplied text.");
  });
});
