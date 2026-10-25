"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button, Card, Tag } from "./ui";

const NewsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string().url(),
      outlet: z.string(),
      publishedAt: z.string().datetime(),
    }),
  ),
  fetchedAt: z.string().datetime(),
  unavailableSources: z.array(z.string()),
  mode: z.enum(["live", "stale", "archived", "unavailable"]),
});
type NewsData = z.infer<typeof NewsSchema>;
const OUTLETS = [
  {
    name: "The Guardian",
    mark: "G",
    detail: "Inflation reporting & analysis",
    url: "https://www.theguardian.com/business/inflation",
    tone: "bg-[#e6efff] text-[#14355b]",
  },
  {
    name: "BBC News",
    mark: "BBC",
    detail: "Business & the cost of living",
    url: "https://www.bbc.com/news/business",
    tone: "bg-[#fff0ec] text-[#b62b20]",
  },
  {
    name: "US Bureau of Labor Statistics",
    mark: "BLS",
    detail: "Official US CPI releases",
    url: "https://www.bls.gov/cpi/",
    tone: "bg-[#e9f7ed] text-[#1c663c]",
  },
];
function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function NewsScreen({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [outlet, setOutlet] = useState("All outlets");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError("");
    fetch("/api/news", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("News request failed");
        return NewsSchema.parse(await response.json());
      })
      .then((result) => {
        if (!ignore) setData(result);
      })
      .catch(() => {
        if (!ignore)
          setError(
            "Headlines are temporarily unavailable. You can still read directly from the sources below.",
          );
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [revision]);
  const items = useMemo(
    () =>
      data?.items.filter(
        (item) => outlet === "All outlets" || item.outlet === outlet,
      ) ?? [],
    [data, outlet],
  );
  if (compact)
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-brand">
              In the headlines
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              Context for your next view.
            </h2>
          </div>
          <p className="text-xs text-muted">
            Inflation · policy · cost of living
          </p>
        </div>
        {loading ? (
          <div
            role="status"
            aria-label="Loading inflation headlines"
            className="grid gap-3 md:grid-cols-3"
          >
            {[0, 1, 2].map((n) => (
              <div
                key={n}
                className="h-36 motion-safe:animate-pulse rounded-2xl border border-line bg-panel"
              />
            ))}
          </div>
        ) : items.length ? (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              {items.slice(0, 3).map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex flex-col rounded-2xl border border-line bg-panel p-5 transition hover:-translate-y-0.5 hover:border-accent/45 motion-reduce:transform-none"
                >
                  <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
                    <span className="font-semibold text-text">
                      {item.outlet}
                    </span>
                    <time dateTime={item.publishedAt}>
                      {dateLabel(item.publishedAt)}
                    </time>
                  </div>
                  <h3 className="mt-4 flex-1 text-base font-semibold leading-snug group-hover:text-brand">
                    {item.title}
                  </h3>
                  <span className="mt-4 text-sm text-brand">Read story ↗</span>
                </a>
              ))}
            </div>
            {data?.mode === "stale" || data?.mode === "archived" ? (
              <p className="text-xs text-muted">
                Saved coverage from {dateLabel(data.fetchedAt)} · source feeds
                temporarily unavailable.
              </p>
            ) : null}
          </>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {OUTLETS.map((source) => (
              <a
                key={source.name}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-5 transition hover:border-accent/45"
              >
                <span
                  className={`grid h-10 min-w-10 place-items-center rounded-xl text-xs font-bold ${source.tone}`}
                >
                  {source.mark}
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{source.name} ↗</h3>
                  <p className="mt-1 text-xs text-muted">{source.detail}</p>
                </div>
              </a>
            ))}
          </div>
        )}
        {!loading && !items.length ? (
          <p className="text-xs text-muted">
            {error || data?.mode === "unavailable"
              ? "Headline feeds are unavailable. Read current coverage directly from the sources above."
              : "No matching headlines in the current feeds. Explore the sources above."}
          </p>
        ) : null}
      </section>
    );
  return (
    <div className="space-y-7">
      <div className="reveal flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-brand">
            The inflation brief
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            What’s moving the story.
          </h1>
          <p className="mt-3 max-w-2xl text-muted">
            Inflation, policy and the cost of living—from the outlets covering
            them. Read the context. Form your own view.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
          className="rounded-full border border-line bg-panel px-4 py-2.5 text-sm font-medium disabled:opacity-40"
        >
          {loading ? "Updating…" : "Refresh coverage ↻"}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div
          role="group"
          aria-label="News outlet"
          className="flex flex-wrap gap-2"
        >
          {["All outlets", "The Guardian", "BBC News"].map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={outlet === name}
              onClick={() => setOutlet(name)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${outlet === name ? "border-night bg-night text-white" : "border-line bg-panel text-muted hover:text-text"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          {data
            ? `${data.mode === "stale" || data.mode === "archived" ? "Saved coverage" : "Checked"} ${dateLabel(data.fetchedAt)}`
            : "Named sources · original reporting"}
        </p>
      </div>
      <div aria-live="polite">
        {loading ? (
          <div
            className="grid gap-4 md:grid-cols-2"
            role="status"
            aria-label="Loading inflation headlines"
          >
            {[0, 1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-48 motion-safe:animate-pulse rounded-3xl border border-line bg-panel p-6"
              >
                <div className="h-3 w-24 rounded bg-panel-2" />
                <div className="mt-6 h-6 w-5/6 rounded bg-panel-2" />
                <div className="mt-3 h-6 w-2/3 rounded bg-panel-2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <Card>
            <h2 className="text-xl font-semibold">
              The story is still at the source.
            </h2>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <div className="mt-4 max-w-40">
              <Button
                variant="secondary"
                onClick={() => setRevision((v) => v + 1)}
              >
                Try again
              </Button>
            </div>
          </Card>
        ) : items.length ? (
          <>
            {data?.mode === "stale" || data?.mode === "archived" ? (
              <p className="mb-4 rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">
                Feeds are unavailable right now. Showing previously retrieved
                headlines with their original publication dates.
              </p>
            ) : null}
            {data?.unavailableSources.length &&
            data.mode !== "stale" &&
            data.mode !== "archived" ? (
              <p className="mb-4 text-xs text-muted">
                Some coverage could not be loaded:{" "}
                {data.unavailableSources.join(", ")}. Available articles are
                shown below.
              </p>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((item, index) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group block rounded-3xl border border-line bg-panel p-6 transition duration-200 hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-lg motion-reduce:transform-none"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center justify-between gap-4">
                    <Tag>{item.outlet}</Tag>
                    <time
                      dateTime={item.publishedAt}
                      className="text-xs text-muted"
                    >
                      {dateLabel(item.publishedAt)}
                    </time>
                  </div>
                  <h2 className="mt-5 text-xl font-semibold leading-snug tracking-tight group-hover:text-brand">
                    {item.title}
                  </h2>
                  <div className="mt-7 flex items-center justify-between text-sm">
                    <span className="text-muted">
                      Read the original reporting
                    </span>
                    <span
                      className="text-brand transition group-hover:translate-x-1 motion-reduce:transform-none"
                      aria-hidden
                    >
                      ↗
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </>
        ) : (
          <Card>
            <Tag>Direct from the source</Tag>
            <h2 className="mt-4 text-2xl font-semibold">
              Keep the bigger picture in view.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
              {data?.mode === "unavailable"
                ? "News feeds could not be reached. Open an outlet below for its current coverage."
                : "There are no inflation headlines in this selection right now. Explore the outlets below or choose another source."}
            </p>
          </Card>
        )}
      </div>
      <section>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            At the source
          </h2>
          <span className="text-xs text-muted">Reporting & official data</span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {OUTLETS.map((source) => (
            <a
              key={source.name}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-4 rounded-2xl border border-line bg-panel p-5 transition hover:border-accent/45"
            >
              <span
                className={`grid h-11 min-w-11 place-items-center rounded-xl text-xs font-bold ${source.tone}`}
              >
                {source.mark}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{source.name} ↗</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {source.detail}
                </p>
              </div>
            </a>
          ))}
        </div>
      </section>
      <p className="text-xs leading-relaxed text-muted">
        Articles open on the publisher’s website. Current reporting is separate
        from the Jan 2021–Dec 2024 historical CPI case study and does not change
        its settlement data.
      </p>
    </div>
  );
}
