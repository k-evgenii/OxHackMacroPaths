// Frontend v2 scenario fixture index (generated list; data from _generate.py). Test/fixture-mode use only.
// Every entry is parsed by its schema in packages/client/test/frontend-v2-fixtures.test.ts.
import { z } from "zod";
import {
  CatalogResponse,
  EventView,
  EventsResponse,
  I64,
  Pubkey,
  ResearchBundle,
  ResearchTerm,
  SessionOverviewResponse,
  SessionView,
  WalletActivityResponse,
  WalletOverviewResponse,
} from "../../src/types";

import catalogReference from "./catalog/reference.json";
import catalogSyntheticMulti from "./catalog/synthetic-multi.json";
import sessionsOpen from "./sessions/open.json";
import sessionsRefunding from "./sessions/refunding.json";
import sessionsResearchMatch from "./sessions/research-match.json";
import sessionsRunning from "./sessions/running.json";
import sessionsSettledMintB from "./sessions/settled-mint-b.json";
import sessionsSettled from "./sessions/settled.json";
import overviewOpenMissingSellerQuote from "./overview/open-missing-seller-quote.json";
import overviewOpenUnfunded from "./overview/open-unfunded.json";
import overviewOpen from "./overview/open.json";
import overviewRefunding from "./overview/refunding.json";
import overviewRunning from "./overview/running.json";
import overviewSectionUnavailable from "./overview/section-unavailable.json";
import overviewSessionA from "./overview/session-a.json";
import overviewSettled from "./overview/settled.json";
import walletAOwned from "./wallet/a-owned.json";
import walletEmptyOwner from "./wallet/empty-owner.json";
import walletOpen from "./wallet/open.json";
import walletRefunding from "./wallet/refunding.json";
import walletRunning from "./wallet/running.json";
import walletSectionUnavailable from "./wallet/section-unavailable.json";
import walletSettledClaimed from "./wallet/settled-claimed.json";
import walletSettledUnclaimed from "./wallet/settled-unclaimed.json";
import walletTwoMints from "./wallet/two-mints.json";
import activityEmpty from "./activity/empty.json";
import activityFull from "./activity/full.json";
import activityPartial from "./activity/partial.json";
import activityRefund from "./activity/refund.json";
import activityThrottled from "./activity/throttled.json";
import eventsPartial from "./events/partial.json";
import eventsSessionAPage from "./events/session-a-page.json";
import eventsThrottled from "./events/throttled.json";
import eventsTwoSessionsOneTxRaw from "./events/two-sessions-one-tx.raw.json";
import eventsTwoSessionsOneTxSessionA from "./events/two-sessions-one-tx.session-a.json";
import researchBundle from "./research/bundle.json";
import researchTermsMatch from "./research/terms-match.json";
import researchTermsMismatchSessionA from "./research/terms-mismatch-session-a.json";

/** Expected association outcome between a session's terms and research bundle terms. */
export const ResearchAssociationFixture = z.object({
  sessionAddress: Pubkey,
  sessionTerms: z.object({ k: I64, dCap: I64, aCap: I64 }),
  bundleId: z.string(),
  bundleTerms: z.object({ cooling: ResearchTerm, excess: ResearchTerm }),
  expected: z.enum(["match", "mismatch"]),
});
export const TwoSessionTxFixture = z.object({ transactionEvents: z.array(EventView) });

type Entry = { schema: z.ZodTypeAny; data: unknown };
const e = (schema: z.ZodTypeAny, data: unknown): Entry => ({ schema, data });

/** All fixtures keyed by "<group>/<name>", each with the schema it must satisfy. */
export const frontendV2Fixtures: Record<string, Entry> = {
  "catalog/reference": e(CatalogResponse, catalogReference),
  "catalog/synthetic-multi": e(CatalogResponse, catalogSyntheticMulti),
  "sessions/open": e(SessionView, sessionsOpen),
  "sessions/refunding": e(SessionView, sessionsRefunding),
  "sessions/research-match": e(SessionView, sessionsResearchMatch),
  "sessions/running": e(SessionView, sessionsRunning),
  "sessions/settled-mint-b": e(SessionView, sessionsSettledMintB),
  "sessions/settled": e(SessionView, sessionsSettled),
  "overview/open-missing-seller-quote": e(SessionOverviewResponse, overviewOpenMissingSellerQuote),
  "overview/open-unfunded": e(SessionOverviewResponse, overviewOpenUnfunded),
  "overview/open": e(SessionOverviewResponse, overviewOpen),
  "overview/refunding": e(SessionOverviewResponse, overviewRefunding),
  "overview/running": e(SessionOverviewResponse, overviewRunning),
  "overview/section-unavailable": e(SessionOverviewResponse, overviewSectionUnavailable),
  "overview/session-a": e(SessionOverviewResponse, overviewSessionA),
  "overview/settled": e(SessionOverviewResponse, overviewSettled),
  "wallet/a-owned": e(WalletOverviewResponse, walletAOwned),
  "wallet/empty-owner": e(WalletOverviewResponse, walletEmptyOwner),
  "wallet/open": e(WalletOverviewResponse, walletOpen),
  "wallet/refunding": e(WalletOverviewResponse, walletRefunding),
  "wallet/running": e(WalletOverviewResponse, walletRunning),
  "wallet/section-unavailable": e(WalletOverviewResponse, walletSectionUnavailable),
  "wallet/settled-claimed": e(WalletOverviewResponse, walletSettledClaimed),
  "wallet/settled-unclaimed": e(WalletOverviewResponse, walletSettledUnclaimed),
  "wallet/two-mints": e(WalletOverviewResponse, walletTwoMints),
  "activity/empty": e(WalletActivityResponse, activityEmpty),
  "activity/full": e(WalletActivityResponse, activityFull),
  "activity/partial": e(WalletActivityResponse, activityPartial),
  "activity/refund": e(WalletActivityResponse, activityRefund),
  "activity/throttled": e(WalletActivityResponse, activityThrottled),
  "events/partial": e(EventsResponse, eventsPartial),
  "events/session-a-page": e(EventsResponse, eventsSessionAPage),
  "events/throttled": e(EventsResponse, eventsThrottled),
  "events/two-sessions-one-tx.raw": e(TwoSessionTxFixture, eventsTwoSessionsOneTxRaw),
  "events/two-sessions-one-tx.session-a": e(EventsResponse, eventsTwoSessionsOneTxSessionA),
  "research/bundle": e(ResearchBundle, researchBundle),
  "research/terms-match": e(ResearchAssociationFixture, researchTermsMatch),
  "research/terms-mismatch-session-a": e(ResearchAssociationFixture, researchTermsMismatchSessionA),
};

/** Typed accessors for the most used scenarios (data typed by schema output). */
export const scenarios = {
  catalog: catalogReference as unknown as CatalogResponse,
  catalogMulti: catalogSyntheticMulti as unknown as CatalogResponse,
  /** Disconnected: no owner, so no wallet overview/activity is requested at all. */
  disconnected: { owner: null, wallet: null, activity: null } as const,
  overview: {
    sessionA: overviewSessionA as unknown as SessionOverviewResponse,
    open: overviewOpen as unknown as SessionOverviewResponse,
    openUnfunded: overviewOpenUnfunded as unknown as SessionOverviewResponse,
    missingSellerQuote: overviewOpenMissingSellerQuote as unknown as SessionOverviewResponse,
    running: overviewRunning as unknown as SessionOverviewResponse,
    refunding: overviewRefunding as unknown as SessionOverviewResponse,
    settled: overviewSettled as unknown as SessionOverviewResponse,
    sectionUnavailable: overviewSectionUnavailable as unknown as SessionOverviewResponse,
  },
  wallet: {
    emptyOwner: walletEmptyOwner as unknown as WalletOverviewResponse,
    aOwned: walletAOwned as unknown as WalletOverviewResponse,
    open: walletOpen as unknown as WalletOverviewResponse,
    running: walletRunning as unknown as WalletOverviewResponse,
    settledUnclaimed: walletSettledUnclaimed as unknown as WalletOverviewResponse,
    settledClaimed: walletSettledClaimed as unknown as WalletOverviewResponse,
    refunding: walletRefunding as unknown as WalletOverviewResponse,
    twoMints: walletTwoMints as unknown as WalletOverviewResponse,
    sectionUnavailable: walletSectionUnavailable as unknown as WalletOverviewResponse,
  },
  activity: {
    full: activityFull as unknown as WalletActivityResponse,
    empty: activityEmpty as unknown as WalletActivityResponse,
    partial: activityPartial as unknown as WalletActivityResponse,
    throttled: activityThrottled as unknown as WalletActivityResponse,
    refund: activityRefund as unknown as WalletActivityResponse,
  },
  events: {
    sessionAPage: eventsSessionAPage as unknown as EventsResponse,
    partial: eventsPartial as unknown as EventsResponse,
    throttled: eventsThrottled as unknown as EventsResponse,
    twoSessionsSessionA: eventsTwoSessionsOneTxSessionA as unknown as EventsResponse,
  },
  research: {
    bundle: researchBundle as unknown as ResearchBundle,
    termsMatch: researchTermsMatch as unknown as z.infer<typeof ResearchAssociationFixture>,
    termsMismatchSessionA: researchTermsMismatchSessionA as unknown as z.infer<typeof ResearchAssociationFixture>,
  },
  sessions: {
    open: sessionsOpen as unknown as SessionView,
    running: sessionsRunning as unknown as SessionView,
    refunding: sessionsRefunding as unknown as SessionView,
    settled: sessionsSettled as unknown as SessionView,
    settledMintB: sessionsSettledMintB as unknown as SessionView,
    researchMatch: sessionsResearchMatch as unknown as SessionView,
  },
};

