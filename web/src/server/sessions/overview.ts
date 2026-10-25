// /api/sessions/[addr]/overview: required session data plus independently available vault and offer sections.
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import * as client from "@macropaths/client";
import { quotePda, sellerPda, toEntryQuoteView, toSellerView, type EntryQuoteView, type SellerView, type SessionView } from "@macropaths/client";
import { findRegistered, presentationOf, type Registry } from "./registry";
import { ownAccount, type SessionRepository } from "./repository";

type S = string;
type Pair<T> = [T, T];
type ReadSection<T> = { status: "ok"; data: T } | { status: "unavailable"; data: null };
export type OfferStatus = "available" | "not_configured" | "closed" | "unfunded";
/** Mirrors the frozen SessionOverviewResponse; the route validates through the shared schema. */
export type SessionOverview = {
  session: SessionView;
  meta: { source: "rpc" | "fixture"; fetchedAt: string };
  presentation: ReturnType<typeof presentationOf>;
  derived: { currentScores: Pair<S> | null; poolDeposited: S };
  vault: ReadSection<{ amounts: Pair<S>; total: S }>;
  coverOffer: ReadSection<{ seller: SellerView | null; quote: EntryQuoteView | null; status: OfferStatus }>;
};

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_ACCOUNT_SIZE = 165;
const UNAVAILABLE = { status: "unavailable", data: null } as const;

/** Amount of an SPL token account after validating program, mint and authority; null if invalid. */
export function tokenAmount(info: AccountInfo<Buffer> | null, mint: string, authority: string): bigint | null {
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length !== TOKEN_ACCOUNT_SIZE) return null;
  const d = info.data;
  if (new PublicKey(d.subarray(0, 32)).toBase58() !== mint) return null;
  if (new PublicKey(d.subarray(32, 64)).toBase58() !== authority) return null;
  if (d[108] !== 1) return null; // AccountState::Initialized
  return d.readBigUInt64LE(64);
}

export const sumAmounts = (values: readonly S[]): S => values.reduce((a, v) => a + BigInt(v), 0n).toString();

type AccruedFn = (session: SessionView) => Pair<S> | null;
/** Agent 01's shared helper (interfaces.md `calculateAccruedScores`). */
const sharedAccrued: AccruedFn = (s) => {
  const fn = (client as unknown as { calculateAccruedScores?: AccruedFn }).calculateAccruedScores;
  if (!fn) throw new Error("calculateAccruedScores is not available from @macropaths/client");
  return fn(s);
};

/**
 * No score before the first observation; final recorded scores when Settled;
 * null (not applicable) when Refunding; otherwise the shared exact accrued helper.
 */
export function currentScores(session: SessionView, accrued: AccruedFn = sharedAccrued): Pair<S> | null {
  if (session.state === "Refunding") return null;
  if (session.state === "Settled") return [...session.scores] as Pair<S>;
  if (session.nextIndex === 0) return null;
  return accrued(session);
}

/** Offer precedence (interfaces.md): closed > not_configured > unfunded > available. */
export function offerStatus(session: SessionView, seller: SellerView | null, quote: EntryQuoteView | null, nowSec: number): OfferStatus {
  if (session.state !== "Open" || nowSec >= session.depositDeadline) return "closed";
  if (!seller || !quote || !quote.isSet) return "not_configured";
  if (BigInt(seller.freeCash) === 0n) return "unfunded";
  return "available";
}

export type OverviewDeps = {
  repository: SessionRepository;
  registry: Registry;
  now?: () => Date;
  accrued?: AccruedFn;
};

export async function buildSessionOverview(address: string, deps: OverviewDeps): Promise<SessionOverview> {
  const now = deps.now ?? (() => new Date());
  const session = await deps.repository.get(address); // required: errors propagate as typed route errors
  const entry = findRegistered(deps.registry, session.address)!;
  const key = new PublicKey(session.address);
  const [sellerKey] = sellerPda(key);
  const [quoteKey] = quotePda(key);

  // Independent reads: one failing must not hide the other or the required session data.
  const [vaultRead, offerRead] = await Promise.allSettled([
    deps.repository.getManyAccounts(session.vaults.map((v) => new PublicKey(v))),
    deps.repository.getManyAccounts([sellerKey, quoteKey]),
  ]);

  let vault: SessionOverview["vault"] = UNAVAILABLE;
  if (vaultRead.status === "fulfilled") {
    const amounts = vaultRead.value.map((i) => tokenAmount(i, session.playMint, session.address));
    if (amounts.length === 2 && amounts.every((a) => a !== null)) {
      const pair = amounts.map(String) as Pair<S>;
      vault = { status: "ok", data: { amounts: pair, total: sumAmounts(pair) } };
    }
  }

  let coverOffer: SessionOverview["coverOffer"] = UNAVAILABLE;
  if (offerRead.status === "fulfilled") {
    const [sInfo, qInfo] = offerRead.value;
    const s = ownAccount(sInfo, "Seller");
    const q = ownAccount(qInfo, "EntryQuote");
    // A present account that is not ours (foreign owner / other kind) is not "missing": unavailable.
    const sellerOk = sInfo === null || s !== null;
    const quoteOk = qInfo === null || q !== null;
    if (sellerOk && quoteOk) {
      try {
        const seller = s ? toSellerView(sellerKey.toBase58(), s) : null;
        const quote = q ? toEntryQuoteView(quoteKey.toBase58(), q) : null;
        coverOffer = { status: "ok", data: { seller, quote, status: offerStatus(session, seller, quote, Math.floor(now().getTime() / 1000)) } };
      } catch {
        coverOffer = UNAVAILABLE;
      }
    }
  }

  return {
    session,
    meta: { source: "rpc", fetchedAt: now().toISOString() },
    presentation: presentationOf(entry),
    derived: { currentScores: currentScores(session, deps.accrued), poolDeposited: sumAmounts(session.sideTotals) },
    vault,
    coverOffer,
  };
}
