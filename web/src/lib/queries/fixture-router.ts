// Explicit fixture mode only (NEXT_PUBLIC_USE_FIXTURES=1). Answers every client endpoint from the
// declared frontend-v2 fixtures without RPC or Redis. fetchJson calls this BEFORE any network request;
// it is never used as a fallback after a live request error.
//
// Catalog: `reference` (session A only) by default; NEXT_PUBLIC_FIXTURE_CATALOG=multi selects the
// synthetic multi-session catalog. Wallet data belongs to the declared fixture owner only: any other
// valid owner receives an empty (zero balance, no holdings) response for the registered set.
import { PROGRAM_ID } from "@macropaths/client";
import catalogReference from "@macropaths/client/fixtures/frontend-v2/catalog/reference.json";
import catalogMulti from "@macropaths/client/fixtures/frontend-v2/catalog/synthetic-multi.json";
import overviewSessionA from "@macropaths/client/fixtures/frontend-v2/overview/session-a.json";
import overviewOpen from "@macropaths/client/fixtures/frontend-v2/overview/open.json";
import overviewRunning from "@macropaths/client/fixtures/frontend-v2/overview/running.json";
import overviewRefunding from "@macropaths/client/fixtures/frontend-v2/overview/refunding.json";
import overviewSettled from "@macropaths/client/fixtures/frontend-v2/overview/settled.json";
import walletAOwned from "@macropaths/client/fixtures/frontend-v2/wallet/a-owned.json";
import walletEmptyOwner from "@macropaths/client/fixtures/frontend-v2/wallet/empty-owner.json";
import activityFull from "@macropaths/client/fixtures/frontend-v2/activity/full.json";
import activityPartial from "@macropaths/client/fixtures/frontend-v2/activity/partial.json";
import activityEmpty from "@macropaths/client/fixtures/frontend-v2/activity/empty.json";
import eventsSessionAPage from "@macropaths/client/fixtures/frontend-v2/events/session-a-page.json";
import eventsPartial from "@macropaths/client/fixtures/frontend-v2/events/partial.json";
import researchBundle from "@macropaths/client/fixtures/frontend-v2/research/bundle.json";
import sessionFixture from "@macropaths/client/fixtures/session-B89z.view.json";
import positionsFixture from "@macropaths/client/fixtures/positions-B89z.view.json";

export type FixtureResult = { status: number; body: unknown };

type Catalog = typeof catalogReference;
type HistoryPage = { nextBefore: string | null; pending: string[]; retryCursor: string | null };

const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

const ok = (body: unknown): FixtureResult => ({ status: 200, body });
const fail = (status: number, code: string, error: string): FixtureResult => ({ status, body: { error, code } });

function catalog(): Catalog {
  return (process.env.NEXT_PUBLIC_FIXTURE_CATALOG === "multi" ? catalogMulti : catalogReference) as Catalog;
}
const registered = (addr: string) => catalog().sessions.some((s) => s.address === addr);

const OVERVIEWS = [overviewSessionA, overviewOpen, overviewRunning, overviewRefunding, overviewSettled] as Array<{
  session: { address: string };
}>;

/** The single declared fixture owner whose holdings and activity are demonstration data. */
export const FIXTURE_OWNER: string = walletAOwned.owner;

function walletOverview(owner: string) {
  if (owner === FIXTURE_OWNER) return walletAOwned;
  // Unrelated wallets never see demonstration ownership: zero balances, null accounts, registered set only.
  return {
    ...walletEmptyOwner,
    owner,
    holdings: catalog().sessions.map((s) => ({
      sessionAddress: s.address,
      read: { status: "ok", data: { position: null, cover: null } },
    })),
  };
}

const complete = <T extends HistoryPage>(page: T, nextBefore: string | null): T => ({
  ...page,
  pending: [],
  retryCursor: null,
  nextBefore,
});

/**
 * Two-page history feed: page 1 is complete; page 2 (before = page1.nextBefore) is partial with a retry
 * cursor; the retry cursor returns the complete same page with the original nextBefore (null: last page).
 */
function historyFeed(
  params: URLSearchParams,
  first: HistoryPage,
  second: HistoryPage,
  emptyPage: HistoryPage,
): FixtureResult {
  const retryCursor = params.get("retryCursor");
  const before = params.get("before");
  const limitRaw = params.get("limit");
  if (retryCursor !== null) {
    if (before !== null || limitRaw !== null) return fail(400, "bad_request", "retryCursor cannot be combined with before/limit");
    if (retryCursor === second.retryCursor) return ok(complete(second, null));
    return fail(400, "bad_request", "invalid or expired retry cursor");
  }
  if (limitRaw !== null && !/^(?:[1-9]|1\d|2[0-5])$/.test(limitRaw)) return fail(400, "bad_request", "limit must be 1..25");
  if (before === null) return ok({ ...first });
  if (!SIGNATURE.test(before)) return fail(400, "bad_request", "before must be a signature");
  if (before === first.nextBefore) return ok({ ...second, nextBefore: null });
  return ok({ ...emptyPage, nextBefore: null });
}

function legacy(p: string): FixtureResult | undefined {
  const s = sessionFixture as { address: string };
  if (p === "/api/health")
    return ok({ cluster: process.env.NEXT_PUBLIC_CLUSTER ?? "devnet", slot: 0, programId: PROGRAM_ID.toBase58(), executable: true });
  if (p === "/api/sessions") {
    const v = sessionFixture as Record<string, unknown>;
    const keys = ["address", "sessionId", "authority", "state", "nObs", "nextIndex", "scores", "sideTotals", "depositDeadline", "replayDeadline"];
    return ok({ sessions: [Object.fromEntries(keys.map((k) => [k, v[k]]))] });
  }
  const m = p.match(/^\/api\/sessions\/([^/]+)(?:\/(positions|seller))?$/);
  if (m) {
    if (m[1] !== s.address) return fail(404, "not_found", "fixture has only session A");
    if (!m[2]) return ok(sessionFixture);
    if (m[2] === "positions") return ok(positionsFixture);
    return ok({ seller: null, quote: null });
  }
  return undefined;
}

/** Fixture answer for an API path, or undefined when no fixture endpoint matches. */
export function fixtureResponse(path: string): FixtureResult | undefined {
  const url = new URL(path, "http://fixture");
  const p = url.pathname;
  const q = url.searchParams;

  if (p === "/api/catalog") return ok(catalog());
  if (p === "/api/artifacts/bundle") return ok(researchBundle);

  let m = p.match(/^\/api\/sessions\/([^/]+)\/overview$/);
  if (m) {
    const addr = decodeURIComponent(m[1]);
    if (!PUBKEY.test(addr)) return fail(400, "bad_request", "invalid session address");
    if (!registered(addr)) return fail(404, "not_found", "session is not registered");
    const o = OVERVIEWS.find((x) => x.session.address === addr);
    return o ? ok(o) : fail(404, "not_found", "no fixture overview for this session");
  }

  m = p.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (m) {
    const addr = decodeURIComponent(m[1]);
    if (!PUBKEY.test(addr)) return fail(400, "bad_request", "invalid session address");
    const noEvents = { nextBefore: null, pending: [], retryCursor: null, events: [] };
    if (!registered(addr)) return fail(404, "not_found", "session is not registered");
    if (addr !== overviewSessionA.session.address) return historyFeed(q, noEvents, noEvents, noEvents);
    return historyFeed(q, eventsSessionAPage as HistoryPage, eventsPartial as HistoryPage, noEvents);
  }

  m = p.match(/^\/api\/wallet\/([^/]+)(\/activity)?$/);
  if (m) {
    const owner = decodeURIComponent(m[1]);
    if (!PUBKEY.test(owner)) return fail(400, "bad_request", "invalid owner address");
    if (!m[2]) return ok(walletOverview(owner));
    if (owner !== FIXTURE_OWNER) return historyFeed(q, activityEmpty as HistoryPage, activityEmpty as HistoryPage, activityEmpty);
    return historyFeed(q, activityFull as HistoryPage, activityPartial as HistoryPage, activityEmpty);
  }

  return legacy(p);
}
