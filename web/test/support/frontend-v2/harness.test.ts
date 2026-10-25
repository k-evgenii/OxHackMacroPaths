// Smoke test of the test-only fixture harness, plus a guard that no production code imports it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { setupServer } from "msw/node";
import {
  ApiError,
  CatalogResponse,
  EventsResponse,
  ResearchBundle,
  SessionOverviewResponse,
  WalletActivityResponse,
  WalletOverviewResponse,
} from "@macropaths/client";
import { scenarios } from "../../../../packages/client/fixtures/frontend-v2";
import { createFixtureFetch, fixtureMswHandlers } from "./handlers";

const A = scenarios.catalog.defaultSession;

describe("frontend v2 fixture fetch", () => {
  const f = createFixtureFetch();
  it("serves schema-valid responses for every new route", async () => {
    CatalogResponse.parse(await (await f("/api/catalog")).json());
    SessionOverviewResponse.parse(await (await f(`/api/sessions/${A}/overview`)).json());
    EventsResponse.parse(await (await f(`/api/sessions/${A}/events?limit=10`)).json());
    ResearchBundle.parse(await (await f("/api/artifacts/bundle")).json());
    const owner = scenarios.wallet.aOwned.owner;
    const w = WalletOverviewResponse.parse(await (await f(`/api/wallet/${owner}`)).json());
    expect(w.holdings[0].read.status).toBe("ok");
    WalletActivityResponse.parse(await (await f(`/api/wallet/${owner}/activity?limit=10`)).json());
  });
  it("unknown session is 404 and forced failures are ApiError bodies", async () => {
    const r = await f("/api/sessions/11111111111111111111111111111111/overview");
    expect(r.status).toBe(404);
    const g = createFixtureFetch({ fail: { wallet: 502 }, activity: "partial" });
    const e = await g(`/api/wallet/${A}`);
    expect(e.status).toBe(502);
    expect(ApiError.parse(await e.json()).code).toBe("rpc_error");
    const p = WalletActivityResponse.parse(await (await g(`/api/wallet/${A}/activity`)).json());
    expect(p.pending.length).toBeGreaterThan(0);
  });
  it("rejects unhandled paths", async () => {
    await expect(f("/api/health")).rejects.toThrow(/no handler/);
  });
});

describe("frontend v2 msw handlers", () => {
  const server = setupServer(...fixtureMswHandlers({ catalog: "multi" }));
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => server.close());
  it("serves the catalog over real fetch", async () => {
    const c = CatalogResponse.parse(await (await fetch("http://localhost/api/catalog")).json());
    expect(c.sessions.length).toBeGreaterThan(1);
  });
});

describe("harness isolation", () => {
  it("no production source imports the test harness or v2 fixtures", () => {
    const root = path.resolve(__dirname, "../../../src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = path.join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx)$/.test(n) && /test\/support|fixtures\/frontend-v2/.test(readFileSync(f, "utf8"))) offenders.push(f);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
