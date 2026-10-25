import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CatalogResponse,
  EventsResponse,
  ResearchBundle,
  SessionOverviewResponse,
  WalletActivityResponse,
  WalletOverviewResponse,
} from "@macropaths/client/types";
import { FIXTURE_OWNER, fixtureResponse } from "./fixture-router";

const A = "B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju";
const OTHER_OWNER = "GGj85c2FS3Ku5zQWNaRqaz8wyZ1aV8bkwio2FAYU7AUw";
const RUNNING = "3UKMQHpTS81vkTh9kaWfnJKqC4NKpAFxtUnmCi4MSdVe";

const body = (path: string) => {
  const r = fixtureResponse(path);
  expect(r, path).toBeDefined();
  return r!;
};

afterEach(() => vi.unstubAllEnvs());

describe("fixture router", () => {
  it("answers catalog and bundle with schema-valid data", () => {
    expect(CatalogResponse.parse(body("/api/catalog").body).defaultSession).toBe(A);
    expect(ResearchBundle.safeParse(body("/api/artifacts/bundle").body).success).toBe(true);
  });

  it("serves only registered session overviews (reference catalog has session A only)", () => {
    const o = SessionOverviewResponse.parse(body(`/api/sessions/${A}/overview`).body);
    expect(o.session.address).toBe(A);
    expect(body(`/api/sessions/${RUNNING}/overview`).status).toBe(404);
    expect(body(`/api/sessions/not-a-key/overview`).status).toBe(400);
  });

  it("multi catalog registers synthetic sessions", () => {
    vi.stubEnv("NEXT_PUBLIC_FIXTURE_CATALOG", "multi");
    const o = SessionOverviewResponse.parse(body(`/api/sessions/${RUNNING}/overview`).body);
    expect(o.session.state).toBe("Running");
  });

  it("gives demonstration holdings only to the declared fixture owner", () => {
    const mine = WalletOverviewResponse.parse(body(`/api/wallet/${FIXTURE_OWNER}`).body);
    expect(mine.holdings.some((h) => h.read.status === "ok" && (h.read.data.position || h.read.data.cover))).toBe(true);

    const other = WalletOverviewResponse.parse(body(`/api/wallet/${OTHER_OWNER}`).body);
    expect(other.owner).toBe(OTHER_OWNER);
    expect(other.holdings.every((h) => h.read.status === "ok" && !h.read.data.position && !h.read.data.cover)).toBe(true);
    expect(other.balances.every((b) => b.read.status === "ok" && b.read.data.amount === "0")).toBe(true);
    expect(other.holdings.map((h) => h.sessionAddress)).toEqual([A]);
  });

  it("unrelated owner activity is empty; fixture owner activity pages then recovers via retry cursor", () => {
    const empty = WalletActivityResponse.parse(body(`/api/wallet/${OTHER_OWNER}/activity?limit=10`).body);
    expect(empty.items).toEqual([]);
    expect(empty.nextBefore).toBeNull();

    const p1 = WalletActivityResponse.parse(body(`/api/wallet/${FIXTURE_OWNER}/activity?limit=10`).body);
    expect(p1.items.length).toBeGreaterThan(0);
    expect(p1.pending).toEqual([]);
    expect(p1.nextBefore).not.toBeNull();

    const p2 = WalletActivityResponse.parse(body(`/api/wallet/${FIXTURE_OWNER}/activity?limit=10&before=${p1.nextBefore}`).body);
    expect(p2.pending.length).toBeGreaterThan(0);
    expect(p2.retryCursor).not.toBeNull();
    expect(p2.nextBefore).toBeNull();

    const retried = WalletActivityResponse.parse(body(`/api/wallet/${FIXTURE_OWNER}/activity?retryCursor=${p2.retryCursor}`).body);
    expect(retried.pending).toEqual([]);
    expect(retried.retryCursor).toBeNull();
    expect(retried.nextBefore).toBe(p2.nextBefore); // original next cursor preserved
    expect(retried.items.map((i) => i.id)).toEqual(p2.items.map((i) => i.id));
  });

  it("rejects bad retry cursors, mixed retry params and out-of-range limits with 400", () => {
    expect(body(`/api/wallet/${FIXTURE_OWNER}/activity?retryCursor=nope`).status).toBe(400);
    expect(body(`/api/wallet/${FIXTURE_OWNER}/activity?retryCursor=x&limit=10`).status).toBe(400);
    expect(body(`/api/wallet/${FIXTURE_OWNER}/activity?limit=26`).status).toBe(400);
    expect(body(`/api/wallet/${FIXTURE_OWNER}/activity?limit=0`).status).toBe(400);
    expect(body(`/api/wallet/${FIXTURE_OWNER}/activity?before=short`).status).toBe(400);
    expect(body(`/api/wallet/bad/activity`).status).toBe(400);
  });

  it("session events page and recover", () => {
    const p1 = EventsResponse.parse(body(`/api/sessions/${A}/events?limit=10`).body);
    expect(p1.events.every((e) => e.session === A)).toBe(true);
    const p2 = EventsResponse.parse(body(`/api/sessions/${A}/events?limit=10&before=${p1.nextBefore}`).body);
    expect(p2.retryCursor).not.toBeNull();
    const r = EventsResponse.parse(body(`/api/sessions/${A}/events?retryCursor=${p2.retryCursor}`).body);
    expect(r.pending).toEqual([]);
    expect(body(`/api/sessions/${RUNNING}/events`).status).toBe(404);
  });

  it("keeps legacy endpoints and returns undefined for unknown paths", () => {
    expect(body("/api/health").status).toBe(200);
    expect(body(`/api/sessions/${A}`).status).toBe(200);
    expect(body(`/api/sessions/${A}/positions`).status).toBe(200);
    expect(fixtureResponse("/api/unknown")).toBeUndefined();
  });
});
