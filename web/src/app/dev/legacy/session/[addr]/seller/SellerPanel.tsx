"use client";
import type { SellerResponse } from "@macropaths/client";
import { useSeller } from "@/components/charts/_fallback/hooks";
import { Badge, Card, EmptyState, ErrorState, Skeleton, Stat } from "@/components/charts/_fallback/ui";
import { fixed, millionthsPct, play, shortAddr } from "@/components/charts/_fallback/format";

const PRODUCTS = ["Inflation Cooling", "Excess Inflation"] as const;

export function SellerPanel({ addr, initial }: { addr: string; initial?: SellerResponse }) {
  const q = useSeller(addr, initial);
  if (q.error) return <main className="p-4"><ErrorState error={q.error} /></main>;
  if (!q.data) return <main className="p-4"><Skeleton /></main>;
  const { seller, quote } = q.data;
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Seller</h1>
      {!seller && !quote ? <EmptyState title="No seller funded this session" /> : null}
      {quote ? (
        <Card title={<span>Entry quote <Badge>{quote.isSet ? "set" : "not set"}</Badge> <Badge>{quote.frozen ? "frozen" : "not frozen"}</Badge></span>}>
          <div className="grid grid-cols-2 gap-3">
            {PRODUCTS.map((p, n) => (
              <Stat key={p} label={p} value={millionthsPct(quote.p[n])} hint="entry quote p" />
            ))}
          </div>
        </Card>
      ) : null}
      {seller ? (
        <Card title={<span>Seller <span className="font-mono">{shortAddr(seller.seller)}</span></span>}>
          <Stat label="Free cash" value={play(seller.freeCash)} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {PRODUCTS.map((p, n) => (
              <div key={p} className="space-y-2">
                <div className="text-sm font-medium">{p} <Badge>{seller.settled[n] ? "settled" : "not settled"}</Badge></div>
                <Stat label="Escrow" value={play(seller.escrow[n])} />
                <Stat label="Units sold" value={fixed(seller.nSold[n], 6)} />
                <Stat label="Premium" value={play(seller.premium[n])} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
