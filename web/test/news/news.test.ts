import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNewsCache,
  getInflationNews,
  NEWS_SOURCES,
  parseNewsFeed,
} from "../../src/server/news";
const NOW = Date.parse("2026-10-25T10:00:00Z");
const guardian = NEWS_SOURCES[0];
const item = (
  title: string,
  link = "https://www.theguardian.com/business/2026/oct/21/inflation",
  date = "Wed, 21 Oct 2026 10:00:00 GMT",
) =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate></item>`;
beforeEach(() => {
  clearNewsCache();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("inflation RSS parsing", () => {
  it("retains source, publication date and an original safe article URL", () => {
    const rows = parseNewsFeed(
      `<rss>${item("Inflation &amp; energy prices <b>rise</b>")}</rss>`,
      guardian,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Inflation & energy prices rise",
      outlet: "The Guardian",
      publishedAt: "2026-10-21T10:00:00.000Z",
    });
  });
  it("rejects off-domain URLs, unsafe protocols, credentials and unrelated headlines", () => {
    const xml = [
      item("Inflation rises", "https://www.theguardian.com.evil.test/x"),
      item("Inflation rises", "javascript:alert(1)"),
      item("Inflation rises", "https://user:secret@www.theguardian.com/x"),
      item("Football results announced"),
    ].join("");
    expect(parseNewsFeed(xml, guardian, NOW)).toEqual([]);
  });
  it("rejects future, malformed and stale publication dates", () => {
    expect(
      parseNewsFeed(
        [
          item("Inflation rises", undefined, "Mon, 26 Oct 2026 10:00:00 GMT"),
          item("Inflation rises", undefined, "bad"),
          item("Inflation rises", undefined, "Tue, 01 Jan 2020 10:00:00 GMT"),
        ].join(""),
        guardian,
        NOW,
      ),
    ).toEqual([]);
  });
  it("does not process XML entities or oversized documents", () => {
    expect(() =>
      parseNewsFeed("<!DOCTYPE rss><rss />", guardian, NOW),
    ).toThrow();
    expect(() => parseNewsFeed("x".repeat(512001), guardian, NOW)).toThrow();
  });
});
describe("inflation news service", () => {
  it("returns partial coverage, deduplicates links and caches requests", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation((url: string) =>
        url.includes("theguardian")
          ? Promise.resolve(
              new Response(
                `<rss>${item("Inflation rises")}${item("Inflation rises")}</rss>`,
              ),
            )
          : Promise.reject(new Error("offline")),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await getInflationNews();
    expect(result.items).toHaveLength(1);
    expect(result.unavailableSources).toEqual(["BBC News"]);
    expect(result.mode).toBe("live");
    await getInflationNews();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("uses only a labelled verified snapshot when all sources fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await getInflationNews();
    expect(result.items).toHaveLength(4);
    expect(result.mode).toBe("archived");
    expect(result.fetchedAt).toBe("2026-10-25T09:48:28.546Z");
    expect(result.unavailableSources).toHaveLength(2);
  });
  it("does not present expired snapshot metadata as recent coverage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2027-05-01T00:00:00Z"));
    const result = await getInflationNews();
    expect(result.items).toEqual([]);
    expect(result.mode).toBe("unavailable");
  });
  it("labels cached coverage stale during an outage", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(`<rss>${item("Inflation rises")}</rss>`));
    vi.stubGlobal("fetch", fetcher);
    await getInflationNews();
    vi.spyOn(Date, "now").mockReturnValue(NOW + 6 * 60_000);
    fetcher.mockRejectedValue(new Error("offline"));
    const result = await getInflationNews();
    expect(result.mode).toBe("stale");
    expect(result.items).toHaveLength(1);
    expect(result.fetchedAt).toBe(new Date(NOW).toISOString());
  });
});
