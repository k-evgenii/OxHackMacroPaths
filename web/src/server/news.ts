import { createHash } from "node:crypto";

export const NEWS_SOURCES = [
  {
    id: "guardian",
    name: "The Guardian",
    feed: "https://www.theguardian.com/business/inflation/rss",
    url: "https://www.theguardian.com/business/inflation",
    hosts: ["www.theguardian.com", "theguardian.com"],
  },
  {
    id: "bbc",
    name: "BBC News",
    feed: "https://feeds.bbci.co.uk/news/business/rss.xml",
    url: "https://www.bbc.com/news/business",
    hosts: ["www.bbc.com", "www.bbc.co.uk", "bbc.com", "bbc.co.uk"],
  },
] as const;

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  outlet: string;
  publishedAt: string;
};
export type NewsResponse = {
  items: NewsItem[];
  fetchedAt: string;
  unavailableSources: string[];
  mode: "live" | "stale" | "archived" | "unavailable";
};
type Source = (typeof NEWS_SOURCES)[number];
const FRESH_MS = 5 * 60_000;
const STALE_MS = 24 * 60 * 60_000;
const MAX_BYTES = 512_000;
const INFLATION_TOPIC =
  /\binflation\b|\bcpi\b|consumer prices?|cost[- ]of[- ]living|interest rates?|central bank|price pressures?|food prices?|energy prices?|borrowing costs?/i;
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

// Headline metadata verified against the publisher's public inflation RSS feed.
// This dated fallback is never labelled as current or used as settlement data.
export const NEWS_SNAPSHOT_AT = "2026-10-25T09:48:28.546Z";
const NEWS_SNAPSHOT: Omit<NewsItem, "id">[] = [
  {
    title:
      "Double blow to Healey as inflation rises to 3.5% and monthly deficit hits £24bn",
    url: "https://www.theguardian.com/business/2026/oct/21/inflation-rises-middle-east-conflict-drives-up-fuel-prices",
    outlet: "The Guardian",
    publishedAt: "2026-10-21T13:21:16.000Z",
  },
  {
    title:
      "Odds of fifth interest rate hike this year shorten as RBA deputy warns inflation outlook ‘worsening’",
    url: "https://www.theguardian.com/australia-news/2026/oct/21/odds-of-fifth-interest-rate-hike-this-year-likely-to-shorten-as-rba-deputy-warns-inflation-outlook-worsening",
    outlet: "The Guardian",
    publishedAt: "2026-10-21T01:48:01.000Z",
  },
  {
    title:
      "Tech market sell-off deepens amid fears over US inflation and AI debt",
    url: "https://www.theguardian.com/business/2026/oct/15/tech-market-sell-off-deepens-amid-fears-over-us-inflation-and-ai-debt",
    outlet: "The Guardian",
    publishedAt: "2026-10-15T14:33:12.000Z",
  },
  {
    title:
      "UK households have paid extra £13,961 on bills since 2021 amid soaring inflation, TUC says",
    url: "https://www.theguardian.com/business/2026/oct/15/uk-households-extra-bills-inflation-tuc",
    outlet: "The Guardian",
    publishedAt: "2026-10-15T05:00:23.000Z",
  },
];

function plainText(value: string): string {
  const unwrapped = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return unwrapped
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (!entity.startsWith("#"))
        return entities[entity.toLowerCase()] ?? match;
      const code = entity.startsWith("#x")
        ? parseInt(entity.slice(2), 16)
        : Number(entity.slice(1));
      return Number.isInteger(code) &&
        code > 31 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : " ";
    })
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const field = (item: string, name: string) =>
  item.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"),
  )?.[1] ?? "";

/** Narrow RSS reader: titles/links/dates only, no XML entities or embedded HTML are executed. */
export function parseNewsFeed(
  xml: string,
  source: Source,
  now = Date.now(),
): NewsItem[] {
  if (xml.length > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported news feed");
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const title = plainText(field(match[1], "title")).slice(0, 240);
    if (title.length < 8 || !INFLATION_TOPIC.test(title)) continue;
    const date = Date.parse(plainText(field(match[1], "pubDate")));
    if (
      !Number.isFinite(date) ||
      date > now ||
      date < now - 120 * 24 * 60 * 60_000
    )
      continue;
    let url: URL;
    try {
      url = new URL(plainText(field(match[1], "link")));
    } catch {
      continue;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !source.hosts.some((h) => h === url.hostname)
    )
      continue;
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^CMP$/i.test(key)) url.searchParams.delete(key);
    const href = url.toString();
    items.push({
      id: createHash("sha256").update(href).digest("hex").slice(0, 16),
      title,
      url: href,
      outlet: source.name,
      publishedAt: new Date(date).toISOString(),
    });
    if (items.length === 30) break;
  }
  return items;
}

async function readFeed(source: Source, now: number): Promise<NewsItem[]> {
  const response = await fetch(source.feed, {
    signal: AbortSignal.timeout(6500),
    headers: { accept: "application/rss+xml, application/xml, text/xml" },
    cache: "no-store",
  });
  if (!response.ok || !response.body)
    throw new Error("News source unavailable");
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) throw new Error("News feed too large");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let xml = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      throw new Error("News feed too large");
    }
    xml += decoder.decode(part.value, { stream: true });
  }
  xml += decoder.decode();
  return parseNewsFeed(xml, source, now);
}

let cache: { at: number; response: NewsResponse } | null = null;
let pending: Promise<NewsResponse> | null = null;
export function clearNewsCache() {
  cache = null;
  pending = null;
}

export async function getInflationNews(): Promise<NewsResponse> {
  const now = Date.now();
  if (cache && now - cache.at < FRESH_MS) return cache.response;
  if (pending) return pending;
  pending = (async () => {
    const results = await Promise.allSettled(
      NEWS_SOURCES.map((source) => readFeed(source, now)),
    );
    const unavailableSources = NEWS_SOURCES.filter(
      (_, i) => results[i].status === "rejected",
    ).map((s) => s.name);
    const items = Array.from(
      new Map(
        results
          .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
          .map((item) => [item.id, item]),
      ).values(),
    )
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 12);
    if (
      !items.length &&
      unavailableSources.length &&
      cache?.response.items.length &&
      now - Date.parse(cache.response.fetchedAt) < STALE_MS
    ) {
      const response: NewsResponse = {
        ...cache.response,
        unavailableSources,
        mode: cache.response.mode === "archived" ? "archived" : "stale",
      };
      cache = { at: now, response };
      return response;
    }
    if (
      !items.length &&
      unavailableSources.length &&
      Date.parse(NEWS_SNAPSHOT_AT) <= now &&
      now - Date.parse(NEWS_SNAPSHOT_AT) < 120 * 24 * 60 * 60_000
    ) {
      const response: NewsResponse = {
        items: NEWS_SNAPSHOT.filter(
          (item) => Date.parse(item.publishedAt) <= now,
        ).map((item) => ({
          ...item,
          id: createHash("sha256").update(item.url).digest("hex").slice(0, 16),
        })),
        fetchedAt: NEWS_SNAPSHOT_AT,
        unavailableSources,
        mode: "archived",
      };
      cache = { at: now, response };
      return response;
    }
    const response: NewsResponse = {
      items,
      fetchedAt: new Date(now).toISOString(),
      unavailableSources,
      mode:
        unavailableSources.length === NEWS_SOURCES.length
          ? "unavailable"
          : "live",
    };
    cache = { at: now, response };
    return response;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
