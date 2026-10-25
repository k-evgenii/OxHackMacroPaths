"use client";
import { PRODUCT_NAMES, type EventView } from "@macropaths/client";
import { Addr, Badge, Card, EmptyState, ErrorState, Num, Skeleton, type BadgeVariant } from "@/components/ui";
import { fmtMillionthsPct, fmtPeriod, fmtPlay, fmtPp, fmtPpMonths, fmtTime, useEvents } from "@/lib/hooks";

const typeVariant: Record<EventView["type"], BadgeVariant> = {
  Observed: "accent",
  Settled: "Settled",
  Claimed: "ok",
  CoverBought: "Open",
};

const play = (v: string) => <Num raw={v} unit="PLAY base units">{fmtPlay(v)}</Num>;

function Details({ e }: { e: EventView }) {
  switch (e.type) {
    case "Observed":
      return (
        <span>
          #{e.data.index} {fmtPeriod(e.data.periodId)}: <Num raw={e.data.value} unit="1e-4 pp">{fmtPp(e.data.value)}</Num>
          <span className="text-muted">
            {" "}peak <Num raw={e.data.peak}>{fmtPp(e.data.peak)}</Num>, max decline{" "}
            <Num raw={e.data.maxDecline}>{fmtPp(e.data.maxDecline)}</Num>, excess{" "}
            <Num raw={e.data.excessAcc}>{fmtPpMonths(e.data.excessAcc)}</Num>
          </span>
        </span>
      );
    case "Settled":
      return (
        <span>
          scores {PRODUCT_NAMES.map((n, p) => (
            <span key={n}>
              {p > 0 && ", "}
              {n} <Num raw={e.data.scores[p]} unit="millionths">{fmtMillionthsPct(e.data.scores[p])}</Num>
            </span>
          ))}
          <span className="text-muted"> ; matched {play(e.data.matched[0])} / {play(e.data.matched[1])}</span>
        </span>
      );
    case "Claimed":
      return (
        <span>
          <Addr value={e.data.owner} /> {e.data.refund ? "refund" : "claim"} {play(e.data.amounts[0])} / {play(e.data.amounts[1])}
        </span>
      );
    case "CoverBought":
      return (
        <span>
          <Addr value={e.data.owner} /> {e.data.units} units of {PRODUCT_NAMES[e.data.product] ?? `product ${e.data.product}`}
          <span className="text-muted">; buyer paid {play(e.data.buyerPaid)}, seller paid {play(e.data.sellerPaid)}</span>
        </span>
      );
  }
}

/** Paged event feed for one session, newest first. */
export function ActivityFeed({ addr }: { addr: string }) {
  const q = useEvents(addr);
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const events = q.data.pages.flatMap((p) => p.events);

  return (
    <Card title={`Activity (${events.length} events loaded)`}>
      {events.length === 0 ? (
        <EmptyState title="No events yet" />
      ) : (
        <ol className="flex flex-col">
          {events.map((e) => (
            <li key={`${e.signature}-${e.type}`} className="flex min-w-0 flex-col gap-1 border-b border-border/50 py-3 text-sm last:border-0 sm:flex-row sm:items-baseline sm:gap-3">
              <div className="flex shrink-0 items-center gap-2 sm:w-32">
                <Badge variant={typeVariant[e.type]}>{e.type}</Badge>
              </div>
              <div className="min-w-0 flex-1 break-words">
                <Details e={e} />
              </div>
              <div className="flex shrink-0 flex-col text-xs text-muted sm:items-end">
                <span className="num">{e.blockTime == null ? `slot ${e.slot}` : fmtTime(e.blockTime)}</span>
                <Addr value={e.signature} kind="tx" />
              </div>
            </li>
          ))}
        </ol>
      )}
      {q.hasNextPage && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className="rounded-full border border-border px-4 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60"
          >
            {q.isFetchingNextPage ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </Card>
  );
}
