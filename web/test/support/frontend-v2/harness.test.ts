// Smoke test of the test-only fixture harness, plus a guard that no production code imports it.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

// Production files allowed to read v2 fixtures: both are explicit fixture mode only
// (NEXT_PUBLIC_USE_FIXTURES=1, docs/frontend-v2/interfaces.md) and load them via dynamic import.
const FIXTURE_MODE_ALLOWLIST = ["lib/queries/fixture-router.ts", "server/wallet/overview.ts"];

describe("harness isolation", { timeout: 60_000 }, () => {
  const root = path.resolve(__dirname, "../../../src");
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

  it("no production source imports the test harness or v2 fixtures (except the gated fixture-mode allowlist)", () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = path.join(d, n);
        const rel = path.relative(root, f).split(path.sep).join("/");
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && /test\/support|fixtures\/frontend-v2/.test(readFileSync(f, "utf8")))
          offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders.filter((f) => !FIXTURE_MODE_ALLOWLIST.includes(f))).toEqual([]);
    // Nothing (allowlisted or not) may import the test harness itself.
    for (const f of FIXTURE_MODE_ALLOWLIST) expect(read(f)).not.toMatch(/test\/support/);
  });

  it("allowlisted files are reached only behind NEXT_PUBLIC_USE_FIXTURES=1 via dynamic import", () => {
    // fixture-router is never statically imported by production code; api-client loads it lazily under USE_FIXTURES.
    const api = read("lib/api-client.ts");
    expect(api).toMatch(/USE_FIXTURES = process\.env\.NEXT_PUBLIC_USE_FIXTURES === "1"/);
    expect(api).toMatch(/await import\("@\/lib\/queries\/fixture-router"\)/);
    expect(api).not.toMatch(/^import .*fixture-router/m);
    const overview = read("server/wallet/overview.ts");
    expect(overview).not.toMatch(/^import .*fixtures\/frontend-v2/m);
    const gate = overview.indexOf('process.env.NEXT_PUBLIC_USE_FIXTURES === "1"');
    expect(gate).toBeGreaterThan(-1);
    expect(overview.indexOf("fixtures/frontend-v2")).toBeGreaterThan(gate);
  });

  describe("live mode (NEXT_PUBLIC_USE_FIXTURES unset)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.doUnmock("@/lib/queries/fixture-router");
      vi.resetModules();
    });

    it("a failed live fetch never falls back to fixtures", async () => {
      vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", "");
      const routerLoaded = vi.fn();
      vi.doMock("@/lib/queries/fixture-router", () => {
        routerLoaded();
        return { fixtureResponse: () => { throw new Error("fixture router reached in live mode"); } };
      });
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
      vi.resetModules();
      const { fetchJson, ApiRequestError } = await import("@/lib/api-client");
      await expect(fetchJson("/api/catalog", CatalogResponse)).rejects.toBeInstanceOf(ApiRequestError);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x", code: "rpc_error" }), { status: 502 })));
      await expect(fetchJson("/api/catalog", CatalogResponse)).rejects.toMatchObject({ status: 502 });
      expect(routerLoaded).not.toHaveBeenCalled();
    });
  });
});
