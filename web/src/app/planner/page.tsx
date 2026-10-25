"use client";
// Exposure planner (research, advisory). Ranks the 21 policies client-side; no wallet, no transactions.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SessionView } from "@macropaths/client";
import { plannerQuery, type PlannerArtifact } from "@/lib/artifacts";
import { DEFAULT_SESSION } from "@/lib/api-client";
import { useSession } from "@/lib/hooks";
import { recommend, showcase, type Product, type Result } from "@/lib/planner";
import { Provenance } from "@/components/shell/Provenance";
import { RESEARCH_CAP, RESEARCH_ILLUSTRATION, sessionCapText, sessionTermsText } from "@/components/shell/ResearchCaps";
import { Badge, Card, ErrorState, Num, Skeleton, Stat } from "./_fallback";

const ILLUSTRATION = "illustration until settlement";
/** Manifest product index the planner's products are scored as on chain; fuel and cash have none. */
const CHAIN_INDEX: Record<Product, number | null> = { cash: null, excess: 1, fuel: null };
const NAME: Record<Product, string> = { cash: "Keep cash", excess: "Excess Inflation", fuel: "Fuel Pass-through" };
const LABEL: Record<Product, string> = {
  excess: "executable on chain",
  fuel: "research proposal, not executable",
  cash: "no contract",
};
const TONE = { excess: "good", fuel: "warn", cash: "muted" } as const;
const CAP_TEXT = (a: PlannerArtifact, p: Product) =>
  p === "excess" ? `${a.caps.excess} × 1e-4 pp-months` : p === "fuel" ? `${a.caps.fuel} × 1e-4 usd-months` : "none";

function ProductTag({ p }: { p: Product }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {NAME[p]} <Badge tone={TONE[p]}>{LABEL[p]}</Badge>
    </span>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/60">
      {label}
      <input
        type="number"
        min={0}
        step="any"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="w-36 rounded border border-white/15 bg-transparent px-2 py-1 text-sm text-white tabular-nums"
      />
    </label>
  );
}

function Planner({ art, session }: { art: PlannerArtifact; session?: SessionView }) {
  const [q, setQ] = useState(art.defaults.q);
  const [B, setB] = useState(art.defaults.B);
  const valid = Number.isFinite(q) && q >= 0 && Number.isFinite(B) && B > 0;
  const plan = useMemo(() => (valid ? recommend(art.scenarios, q, B, art.prices) : null), [art, q, B, valid]);
  const best = plan?.best;
  const show = useMemo(() => (best ? showcase(best, art.showcase, q, B, art.prices) : null), [art, best, q, B]);
  const n = art.scenarios.length;
  const first = art.scenarios[0]?.start;
  const last = art.scenarios[n - 1]?.start;

  return (
    <>
      <Card title="Inputs">
        <div className="flex flex-wrap items-end gap-6">
          <NumberInput label="Gallons per month" value={q} onChange={setQ} />
          <NumberInput label="Protection budget (units)" value={B} onChange={setB} />
          <Stat label="Budget price (fixed)" value={`${art.defaults.G.toFixed(2)} usd/gal`} />
          <Stat label="Excess Inflation entry price" value={art.prices.excess} hint={ILLUSTRATION} />
          <Stat label="Fuel entry price" value={art.prices.fuel} hint={ILLUSTRATION} />
          <Stat
            label={`${RESEARCH_CAP}s`}
            value={<span className="text-sm">{CAP_TEXT(art, "excess")}; {CAP_TEXT(art, "fuel")}</span>}
            hint={`manifest caps, research only; ${session ? sessionTermsText(session) : "an on-chain session scores against its own terms"}`}
          />
        </div>
        {!valid ? <p className="mt-2 text-xs text-red-300">Enter gallons ≥ 0 and a budget &gt; 0.</p> : null}
      </Card>

      {best && plan && show ? (
        <>
          <Recommendation art={art} best={best} n={n} first={first} last={last} session={session} />
          <Card title={`Historical showcase 2021-24 (${RESEARCH_ILLUSTRATION})`}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <Stat label="overrun" value={<Num value={show.overrun} />} />
              <Stat label="stake" value={<Num value={show.stake} />} />
              <Stat label="payout" value={<Num value={show.payout} />} />
              <Stat label="remaining cash" value={<Num value={show.remaining_cash} />} />
              <Stat label="shortfall" value={<Num value={show.shortfall} />} />
              <Stat label="cash baseline shortfall" value={<Num value={show.cash_baseline_shortfall} />} />
            </div>
            <p className="mt-2 text-xs text-white/50">
              historical showcase, not a validation set; scored against the {RESEARCH_CAP}s above; {ILLUSTRATION}
            </p>
          </Card>
          <PolicyTable rows={plan.ranked} best={best} />
        </>
      ) : null}
    </>
  );
}

function Recommendation({
  art,
  best,
  n,
  first,
  last,
  session,
}: {
  art: PlannerArtifact;
  best: Result;
  n: number;
  first?: string;
  last?: string;
  session?: SessionView;
}) {
  const maxPayout = best.units; // score capped at 1
  const ownCap = best.product === "cash" ? null : sessionCapText({ index: CHAIN_INDEX[best.product] }, session);
  return (
    <Card title="Recommendation">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="product" value={best.product === "cash" ? "keep cash" : <ProductTag p={best.product} />} />
        <Stat label="stake" value={<Num value={best.stake} />} />
        <Stat label="units" value={<Num value={best.units} />} />
        <Stat label={RESEARCH_CAP} value={<span className="text-sm">{CAP_TEXT(art, best.product)}</span>} hint={ownCap ?? undefined} />
        <Stat label="maximum payout" value={<Num value={maxPayout} />} hint={ILLUSTRATION} />
      </div>
      <p className="mt-3 text-sm">
        A maximum score pays <Num value={maxPayout} /> and leaves <Num value={best.tail_loss_95} /> uncovered in the worst
        historical 5 %.
      </p>
      <p className="mt-1 text-xs text-white/50">
        {n} overlapping 48-month windows {first}..{last}; an empirical decision score, not a probability.
      </p>
      <div className="mt-4">
        {best.product === "excess" && (
          <button type="button" disabled className="cursor-not-allowed rounded border border-white/20 px-3 py-1.5 text-sm text-white/50">
            Wallet flow comes next
          </button>
        )}
        <p className="mt-1 text-xs text-white/50">
          {best.product === "excess"
            ? `Not available yet. The planned flow would deposit [0, 0, ${Math.round(best.stake * 1e6)}, 0] PLAY base units (stake·1e6 on product 1, side 0), or buy_cover(1, ${best.units.toFixed(0)}) if the seller extension is live; the other side is funded by the disclosed seed wallet.`
            : best.product === "fuel"
              ? "Research proposal only: the deployed program has no fuel product, so there is nothing to buy or deposit for this recommendation."
              : "No contract: keep the budget as a cash reserve."}
        </p>
      </div>
    </Card>
  );
}

function PolicyTable({ rows, best }: { rows: Result[]; best: Result }) {
  const th = "px-2 py-1.5 text-right font-medium";
  const td = "px-2 py-1.5 text-right tabular-nums";
  return (
    <Card title="All 21 policies, sorted by TailLoss95">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-white/50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">product</th>
              <th className={th}>stake</th>
              <th className={th}>units at quoted price</th>
              <th className={th}>TailLoss95</th>
              <th className={th}>mean shortfall</th>
              <th className={th}>max shortfall</th>
              <th className={th}>cap-binding freq</th>
              <th className={th}>expected end cash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.product}-${r.stake}`} className={r === best ? "bg-emerald-400/10" : "border-t border-white/5"}>
                <td className="px-2 py-1.5"><ProductTag p={r.product} /></td>
                <td className={td}><Num value={r.stake} /></td>
                <td className={td}><Num value={r.units} /></td>
                <td className={td}><Num value={r.tail_loss_95} /></td>
                <td className={td}><Num value={r.mean_shortfall} /></td>
                <td className={td}><Num value={r.max_shortfall} /></td>
                <td className={td}><Num value={r.cap_binding_freq * 100} digits={1} suffix=" %" /></td>
                <td className={td}><Num value={r.expected_end_cash} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-white/50">Projected figures: {ILLUSTRATION}.</p>
    </Card>
  );
}

export default function PlannerPage() {
  const { data, error } = useQuery(plannerQuery);
  // The reference session gives the on-chain caps to show beside the research p90 caps; optional, never blocking.
  const session = useSession(DEFAULT_SESSION).data;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Exposure planner</h1>
        <p className="mt-1 text-sm text-amber-200/80">Research layer, advisory. Read-only: no wallet, no transactions.</p>
      </header>
      <Provenance />
      {error ? <ErrorState error={error} /> : null}
      {data ? <Planner art={data} session={session} /> : !error ? <Skeleton className="h-96" /> : null}
    </div>
  );
}
