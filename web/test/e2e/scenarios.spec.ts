import { expect, test } from "@playwright/test";
import { withFixtures } from "./support";

// Skeletons: routes/selectors are filled in as producer branches land (see report 15).
const SCENARIOS = [
  { name: "disconnected", path: "/", opts: {} },
  { name: "empty-owner", path: "/portfolio", opts: { wallet: "emptyOwner" } },
  { name: "partial-history", path: "/activity", opts: {} },
  { name: "catalog-error", path: "/", opts: { fail: { catalog: 502 } } },
] as const;

for (const s of SCENARIOS) {
  test(`${s.name}: renders without browser RPC or hydration errors`, async ({ page }, info) => {
    const probe = await withFixtures(page, s.opts as never);
    await page.goto(s.path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: info.outputPath(`${s.name}.png`), fullPage: true });
    expect(probe.rpc, "browser must not call RPC").toEqual([]);
    expect(probe.consoleErrors.filter((e) => /hydrat/i.test(e))).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(0);
  });
}

test("dev console is reachable only when DEV_CONSOLE=1", async ({ page }) => {
  const res = await page.goto("/dev");
  expect(res?.status()).toBe(process.env.DEV_CONSOLE === "0" ? 404 : 200);
  const bypass = await page.goto("/dev?dev=1");
  expect(bypass?.status()).toBe(process.env.DEV_CONSOLE === "0" ? 404 : 200);
});
