import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  EventsResponse,
  Health,
  PROGRAM_ID,
  PositionsResponse,
  SellerResponse,
  SessionList,
  SessionView,
} from "@macropaths/client";
import { SESSION_A, makeFakeConnection, txs } from "./fakes";

const fake = vi.hoisted(() => ({ conn: undefined as unknown }));

vi.mock("@solana/web3.js", async (orig) => {
  const real = await orig<typeof import("@solana/web3.js")>();
  // Every `new Connection()` delegates to the per-test fake.
  class Connection {
    constructor() {
      return new Proxy({}, { get: (_t, p) => (fake.conn as Record<string | symbol, unknown>)[p] });
    }
  }
  return { ...real, Connection };
});

// Only the functions fe-01 implements are replaced; constants stay real.
vi.mock("@macropaths/client", async (orig) => {
  const real = await orig<typeof import("@macropaths/client")>();
  const { clientFakes } = await import("./fakes");
  return { ...real, ...clientFakes };
});

import { clearCache, retryConfig } from "@/server/rpc";
import { clearTxCache } from "@/server/chain";
import * as health from "@/app/api/health/route";
import * as sessions from "@/app/api/sessions/route";
import * as session from "@/app/api/sessions/[addr]/route";
import * as positions from "@/app/api/sessions/[addr]/positions/route";
import * as seller from "@/app/api/sessions/[addr]/seller/route";
import * as events from "@/app/api/sessions/[addr]/events/route";
import * as artifacts from "@/app/api/artifacts/[name]/route";

let conn: ReturnType<typeof makeFakeConnection>;
beforeEach(() => {
  conn = makeFakeConnection();
  fake.conn = conn;
  clearCache();
  clearTxCache();
  retryConfig.baseMs = 1;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const req = (url = "http://x/") => new Request(url);
const MISSING = "11111111111111111111111111111112";
const account = (owner: unknown, data: Buffer) => ({ owner, data, executable: false, lamports: 1, rentEpoch: 0 }) as never;

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ApiError.parse(await res.json()).code).toBe(code);
}

describe("GET /api/health", () => {
  it("reports cluster, slot and program executable", async () => {
    const res = await health.GET();
    expect(res.status).toBe(200);
    expect(Health.parse(await res.json())).toEqual({
      cluster: "devnet",
      slot: 123456,
      programId: PROGRAM_ID.toBase58(),
      executable: true,
    });
  });
  it("maps RPC failure to 502", async () => {
    conn.getSlot.mockRejectedValue(new Error("fetch failed"));
    await expectError(await health.GET(), 502, "rpc_error");
  });
});

describe("GET /api/sessions", () => {
  it("lists session summaries filtered by the Session discriminator", async () => {
    const res = await sessions.GET();
    expect(res.status).toBe(200);
    const list = SessionList.parse(await res.json());
    expect(list.sessions.map((s) => s.address)).toEqual([SESSION_A]);
    expect(Object.keys(list.sessions[0])).not.toContain("path");
    expect(conn.getProgramAccounts.mock.calls[0][1].filters[0].memcmp.offset).toBe(0);
  });
  it("502 on RPC failure", async () => {
    conn.getProgramAccounts.mockRejectedValue(new Error("503 Service Unavailable"));
    await expectError(await sessions.GET(), 502, "rpc_error");
  });
});

describe("GET /api/sessions/[addr]", () => {
  it("returns the session view", async () => {
    const res = await session.GET(req(), params({ addr: SESSION_A }));
    expect(res.status).toBe(200);
    const v = SessionView.parse(await res.json());
    expect(v.state).toBe("Settled");
    expect(v.scores).toEqual(["827387", "863980"]);
  });
  it("caches the read", async () => {
    await session.GET(req(), params({ addr: SESSION_A }));
    await session.GET(req(), params({ addr: SESSION_A }));
    expect(conn.getAccountInfo).toHaveBeenCalledTimes(1);
  });
  it("400 on an invalid pubkey", async () => {
    await expectError(await session.GET(req(), params({ addr: "not-a-key!" })), 400, "bad_request");
  });
  it("404 on a missing account", async () => {
    await expectError(await session.GET(req(), params({ addr: MISSING })), 404, "not_found");
  });
  it("404 on an account owned by another program", async () => {
    conn.getAccountInfo.mockResolvedValueOnce(account(new (await import("@solana/web3.js")).PublicKey(MISSING), Buffer.alloc(913)));
    await expectError(await session.GET(req(), params({ addr: SESSION_A })), 404, "not_found");
  });
  it("404 on a program account with the wrong discriminator", async () => {
    conn.getAccountInfo.mockResolvedValueOnce(account(PROGRAM_ID, Buffer.alloc(913)));
    await expectError(await session.GET(req(), params({ addr: SESSION_A })), 404, "not_found");
  });
  it("502 on RPC failure", async () => {
    conn.getAccountInfo.mockRejectedValue(new Error("ECONNRESET"));
    await expectError(await session.GET(req(), params({ addr: SESSION_A })), 502, "rpc_error");
  });
});

describe("GET /api/sessions/[addr]/positions", () => {
  it("classifies children into positions and covers", async () => {
    const res = await positions.GET(req(), params({ addr: SESSION_A }));
    expect(res.status).toBe(200);
    const p = PositionsResponse.parse(await res.json());
    expect(p.positions.map((x) => x.address)).toEqual(["9umL3uakhneZ1iZraj3AWuR4yU9mnb1UCmMBRQMBDaBW"]);
    expect(p.covers).toEqual([]);
    expect(conn.getProgramAccounts.mock.calls[0][1].filters[0].memcmp).toEqual({ offset: 8, bytes: SESSION_A });
  });
  it("404 for a missing session", async () => {
    await expectError(await positions.GET(req(), params({ addr: MISSING })), 404, "not_found");
  });
});

describe("GET /api/sessions/[addr]/seller", () => {
  it("returns nulls when the seller and quote accounts are absent", async () => {
    const res = await seller.GET(req(), params({ addr: SESSION_A }));
    expect(res.status).toBe(200);
    expect(SellerResponse.parse(await res.json())).toEqual({ seller: null, quote: null });
    expect(conn.getMultipleAccountsInfo.mock.calls[0][0]).toHaveLength(2);
  });
  it("400 for a bad address", async () => {
    await expectError(await seller.GET(req(), params({ addr: "0OIl" })), 400, "bad_request");
  });
});

describe("GET /api/sessions/[addr]/events", () => {
  const url = (q = "") => req(`http://x/api/sessions/${SESSION_A}/events${q}`);

  it("pages newest first with nextBefore", async () => {
    const r1 = await events.GET(url("?limit=50"), params({ addr: SESSION_A }));
    expect(r1.status).toBe(200);
    const p1 = EventsResponse.parse(await r1.json());
    expect(p1.nextBefore).toBe(txs[49].signature);
    expect(p1.events[0].type).toBe("Settled");
    const r2 = await events.GET(url(`?before=${p1.nextBefore}&limit=50`), params({ addr: SESSION_A }));
    const p2 = EventsResponse.parse(await r2.json());
    expect(p2.nextBefore).toBeNull();
    const all = [...p1.events, ...p2.events];
    expect(all.filter((e) => e.type === "Observed")).toHaveLength(48);
    expect(all.filter((e) => e.type === "Settled")).toHaveLength(1);
    const slots = all.map((e) => e.slot);
    expect(slots).toEqual([...slots].sort((a, b) => b - a));
  });
  it("defaults to limit 50", async () => {
    await events.GET(url(), params({ addr: SESSION_A }));
    expect(conn.getSignaturesForAddress.mock.calls[0][1]).toMatchObject({ limit: 50 });
  });
  it("caches transactions by signature", async () => {
    await events.GET(url("?limit=10"), params({ addr: SESSION_A }));
    clearCache(); // drop the TTL cache, keep the permanent tx cache
    await events.GET(url("?limit=10"), params({ addr: SESSION_A }));
    expect(conn.getSignaturesForAddress).toHaveBeenCalledTimes(2);
    expect(conn.getTransaction).toHaveBeenCalledTimes(10);
  });
  it("retries getTransaction on HTTP 429", async () => {
    conn.getTransaction.mockRejectedValueOnce(new Error("429 Too Many Requests"));
    const res = await events.GET(url("?limit=3"), params({ addr: SESSION_A }));
    expect(res.status).toBe(200);
    expect(EventsResponse.parse(await res.json()).events).toHaveLength(3);
    expect(conn.getTransaction).toHaveBeenCalledTimes(4);
  });
  it("502 when 429 persists", async () => {
    conn.getTransaction.mockRejectedValue(new Error("429 Too Many Requests"));
    await expectError(await events.GET(url("?limit=3"), params({ addr: SESSION_A })), 502, "rpc_error");
  });
  it.each(["?limit=0", "?limit=101", "?limit=abc", "?limit=2.5", "?before=xyz"])("400 for %s", async (q) => {
    await expectError(await events.GET(url(q), params({ addr: SESSION_A })), 400, "bad_request");
  });
  it("404 for a missing session", async () => {
    await expectError(await events.GET(url(), params({ addr: MISSING })), 404, "not_found");
  });
});

describe("GET /api/artifacts/[name]", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mp-artifacts-"));
  writeFileSync(path.join(dir, "manifest.json"), '{"hello":[1,2]}');
  writeFileSync(path.join(dir, "planner.json"), "{broken");
  beforeEach(() => {
    process.env.ARTIFACTS_DIR = dir;
  });

  it("returns the file as-is", async () => {
    const res = await artifacts.GET(req(), params({ name: "manifest" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"hello":[1,2]}');
  });
  it("404 when the file is missing", async () => {
    await expectError(await artifacts.GET(req(), params({ name: "forecast" })), 404, "not_found");
  });
  it("404 for an unknown name", async () => {
    await expectError(await artifacts.GET(req(), params({ name: "../secrets" })), 404, "not_found");
  });
  it("500 for a corrupt file", async () => {
    await expectError(await artifacts.GET(req(), params({ name: "planner" })), 500, "internal");
  });
});
