import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  catalogQuery,
  eventsQuery,
  firstRecoverablePage,
  historyPath,
  nextHistoryParam,
  recoverHistoryPage,
  replaceHistoryPage,
  researchBundleQuery,
  sessionOverviewQuery,
  sessionPollInterval,
  walletActivityQuery,
  walletOverviewQuery,
  type HistoryMeta,
  type HistoryPageParam,
} from "@/lib/queries";
import * as legacy from "@/lib/hooks/queries";

afterEach(() => vi.unstubAllGlobals());

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("frozen query keys", () => {
  it("match interfaces.md", () => {
    expect(catalogQuery().queryKey).toEqual(["catalog"]);
    expect(sessionOverviewQuery("S").queryKey).toEqual(["session", "S", "overview"]);
    expect(walletOverviewQuery("O").queryKey).toEqual(["wallet", "O", "overview"]);
    expect(walletActivityQuery("O").queryKey).toEqual(["wallet", "O", "activity", 10]);
    expect(walletActivityQuery("O", 5).queryKey).toEqual(["wallet", "O", "activity", 5]);
    expect(eventsQuery("S").queryKey).toEqual(["session", "S", "events", 10]);
    expect(researchBundleQuery("b1").queryKey).toEqual(["research", "b1"]);
  });

  it("isolate owners: two owners never share a cache entry", () => {
    expect(walletOverviewQuery("A").queryKey).not.toEqual(walletOverviewQuery("B").queryKey);
    expect(walletActivityQuery("A").queryKey).not.toEqual(walletActivityQuery("B").queryKey);
  });

  it("legacy hooks keep compiling and share the v2 events implementation", () => {
    expect(legacy.eventsQuery).toBe(eventsQuery);
    expect(legacy.sessionQuery("S").queryKey).toEqual(["session", "S"]);
  });
});

describe("freshness policy", () => {
  it("polls Open 15s, Running 5s, terminal 60s; nothing before data", () => {
    expect(sessionPollInterval("Open")).toBe(15_000);
    expect(sessionPollInterval("Running")).toBe(5_000);
    expect(sessionPollInterval("Settled")).toBe(60_000);
    expect(sessionPollInterval("Refunding")).toBe(60_000);
    expect(sessionPollInterval(undefined)).toBe(false);
    expect(walletOverviewQuery("O").refetchInterval).toBe(15_000);
  });

  it("history uses retry: 0 and no interval polling", () => {
    const q = walletActivityQuery("O");
    expect(q.retry).toBe(0);
    expect((q as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();
    expect(eventsQuery("S").retry).toBe(0);
  });
});

describe("history page protocol", () => {
  it("builds normal and retry URLs (retry carries only retryCursor)", () => {
    expect(historyPath("/api/w/activity", {}, 10)).toBe("/api/w/activity?limit=10");
    expect(historyPath("/api/w/activity", { before: "sig" }, 5)).toBe("/api/w/activity?limit=5&before=sig");
    expect(historyPath("/api/w/activity", { retryCursor: "tok", before: "sig" }, 5)).toBe("/api/w/activity?retryCursor=tok");
  });

  it("uses nextBefore for the next page", () => {
    expect(nextHistoryParam({ nextBefore: "s", pending: [], retryCursor: null })).toEqual({ before: "s" });
    expect(nextHistoryParam({ nextBefore: null, pending: [], retryCursor: null })).toBeUndefined();
  });

  type Page = HistoryMeta & { items: string[] };
  const data = (): InfiniteData<Page, HistoryPageParam> => ({
    pages: [
      { items: ["a"], nextBefore: "s1", pending: [], retryCursor: null },
      { items: ["b"], nextBefore: "s2", pending: ["p"], retryCursor: "tok" },
    ],
    pageParams: [{}, { before: "s1" }],
  });

  it("replaces the matching page in place (not appended)", () => {
    const next = replaceHistoryPage(data(), 1, { items: ["b", "c"], nextBefore: "s2", pending: [], retryCursor: null });
    expect(next.pages).toHaveLength(2);
    expect(next.pages[1].items).toEqual(["b", "c"]);
    expect(next.pageParams[1]).toEqual({ before: "s1" });
    expect(firstRecoverablePage(data())).toBe(1);
    expect(firstRecoverablePage(next)).toBe(-1);
  });

  it("recoverHistoryPage fetches with the cursor and swaps the page in the cache", async () => {
    const client = new QueryClient();
    const key = ["wallet", "O", "activity", 10];
    client.setQueryData(key, data());
    const fetchPage = vi.fn(async (p: HistoryPageParam) => ({ items: ["b", "c"], nextBefore: "s2", pending: [], retryCursor: null, p }));
    await recoverHistoryPage(client, key, 1, fetchPage);
    expect(fetchPage).toHaveBeenCalledWith({ retryCursor: "tok" }, undefined);
    const after = client.getQueryData<InfiniteData<Page>>(key)!;
    expect(after.pages).toHaveLength(2);
    expect(after.pages[1].items).toEqual(["b", "c"]);
  });

  it("drops a recovery result when the page changed meanwhile", async () => {
    const client = new QueryClient();
    const key = ["k"];
    client.setQueryData(key, data());
    const res = await recoverHistoryPage(client, key, 1, async () => {
      client.setQueryData(key, { ...data(), pages: [data().pages[0], { ...data().pages[1], retryCursor: "other" }] });
      return { items: ["x"], nextBefore: null, pending: [], retryCursor: null };
    });
    expect(res).toBeNull();
    expect(client.getQueryData<InfiniteData<Page>>(key)!.pages[1].items).toEqual(["b"]);
  });

  it("infinite query fetches through the application API with the page param and a signal", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      respond({ items: [], nextBefore: null, pending: [], retryCursor: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    await client.fetchInfiniteQuery(walletActivityQuery("GGj85c2FS3Ku5zQWNaRqaz8wyZ1aV8bkwio2FAYU7AUw"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/wallet/GGj85c2FS3Ku5zQWNaRqaz8wyZ1aV8bkwio2FAYU7AUw/activity?limit=10");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("research bundle", () => {
  it("rejects a bundle whose id differs from the requested version", async () => {
    const { scenarios } = await import("../../../../packages/client/fixtures/frontend-v2/index");
    vi.stubGlobal("fetch", vi.fn(async () => respond(scenarios.research.bundle)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(client.fetchQuery(researchBundleQuery("research-other"))).rejects.toMatchObject({ code: "bundle_mismatch" });
    await expect(client.fetchQuery(researchBundleQuery(scenarios.research.bundle.id))).resolves.toMatchObject({
      id: scenarios.research.bundle.id,
    });
  });
});

describe("cancellation", () => {
  it("cancelQueries aborts the in-flight wallet request", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }),
    );
    const client = new QueryClient();
    const owner = "GGj85c2FS3Ku5zQWNaRqaz8wyZ1aV8bkwio2FAYU7AUw";
    const p = client.fetchQuery(walletOverviewQuery(owner)).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
    await client.cancelQueries({ queryKey: ["wallet", owner] });
    await p;
    expect(seen?.aborted).toBe(true);
    expect(client.getQueryData(["wallet", owner, "overview"])).toBeUndefined();
  });
});
