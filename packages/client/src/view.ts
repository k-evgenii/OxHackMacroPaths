import { b58, big, dec, decodeAccount, decs, hex } from "./decode";
import { claimAmount, coverPayout, recomputePath } from "./math";
import type { CoverView, EntryQuoteView, PositionView, SellerView, SessionState, SessionView } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
type T2 = [string, string];
type T4 = [string, string, string, string];
const I64_MIN = -(1n << 63n);

export function toSessionView(address: string, data: Uint8Array): SessionView {
  const s = decodeAccount<Raw>("Session", data);
  const nextIndex = Number(s.next_index);
  const nObs = Number(s.n_obs);
  const commitment = hex(s.commitment);
  const terminal = hex(s.terminal);
  const peak = big(s.peak);
  const lastPeriodId = Number(s.last_period_id);
  return {
    address,
    sessionId: dec(s.session_id),
    authority: b58(s.authority),
    playMint: b58(s.play_mint),
    vaults: (s.vaults as unknown[]).map(b58) as T2,
    state: Object.keys(s.state)[0] as SessionState,
    datasetId: hex(s.dataset_id),
    commitment,
    terminal,
    integrityOk: commitment === terminal && nextIndex === nObs,
    nObs,
    nextIndex,
    lastPeriodId,
    terms: { k: dec(s.k), dCap: dec(s.d_cap), aCap: dec(s.a_cap) },
    depositDeadline: Number(dec(s.deposit_deadline)),
    replayDeadline: Number(dec(s.replay_deadline)),
    sideTotals: decs<T4>(s.side_totals),
    matched: decs<T2>(s.matched),
    stats: {
      peak: peak === I64_MIN ? null : peak.toString(),
      maxDecline: dec(s.max_decline),
      excessAcc: dec(s.excess_acc),
    },
    scores: decs<T2>(s.scores),
    pBudget: decs<T4>(s.p_budget),
    rBudget: decs<T4>(s.r_budget),
    counts: {
      positions: Number(s.position_count),
      claimed: Number(s.claimed_count),
      covers: Number(s.cover_count),
      coversClaimed: Number(s.cover_claimed_count),
      sellerProductsOpen: Number(s.seller_products_open),
    },
    path: recomputePath((s.values as unknown[]).slice(0, nextIndex).map(big), big(s.k), lastPeriodId),
  };
}

/** payout per side: claimAmount when Settled, deposits when Refunding, else null. */
export function toPositionView(address: string, data: Uint8Array, session: SessionView): PositionView {
  const p = decodeAccount<Raw>("Position", data);
  const deposited = decs<T4>(p.deposited);
  let payout: T4 | null = null;
  if (session.state === "Settled") {
    payout = deposited.map((a, j) =>
      claimAmount(
        BigInt(a),
        BigInt(session.rBudget[j]),
        BigInt(session.pBudget[j]),
        BigInt(session.sideTotals[j]),
      ).toString(),
    ) as T4;
  } else if (session.state === "Refunding") {
    payout = [...deposited];
  }
  return { address, owner: b58(p.owner), deposited, claimed: Boolean(p.claimed), payout };
}

/** payout per product: coverPayout when Settled, premiumPaid when Refunding, else null. */
export function toCoverView(address: string, data: Uint8Array, session: SessionView): CoverView {
  const c = decodeAccount<Raw>("Cover", data);
  const units = decs<T2>(c.units);
  const premiumPaid = decs<T2>(c.premium_paid);
  let payout: T2 | null = null;
  if (session.state === "Settled") {
    payout = units.map((u, i) => coverPayout(BigInt(session.scores[i]), BigInt(u)).toString()) as T2;
  } else if (session.state === "Refunding") {
    payout = [...premiumPaid];
  }
  return { address, owner: b58(c.owner), units, premiumPaid, claimed: Boolean(c.claimed), payout };
}

export function toSellerView(address: string, data: Uint8Array): SellerView {
  const s = decodeAccount<Raw>("Seller", data);
  return {
    address,
    seller: b58(s.seller),
    freeCash: dec(s.free_cash),
    escrow: decs<T2>(s.escrow),
    nSold: decs<T2>(s.n_sold),
    premium: decs<T2>(s.premium),
    settled: (s.settled as unknown[]).map(Boolean) as [boolean, boolean],
  };
}

export function toEntryQuoteView(address: string, data: Uint8Array): EntryQuoteView {
  const q = decodeAccount<Raw>("EntryQuote", data);
  return { address, p: decs<T2>(q.p), isSet: Boolean(q.is_set), frozen: Boolean(q.frozen) };
}
