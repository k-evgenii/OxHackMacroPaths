// RPC failure handling: readable messages, stale reads while the RPC rate-limits, health caching, RPC_URL fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SessionView } from "@macropaths/client";
import { SESSION_A, makeFakeConnection } from "./fakes";

const fake = vi.hoisted(() => ({ conn: undefined as unknown }));

vi.mock("@solana/web3.js", async (orig) => {
  const real = await orig<typeof import("@solana/web3.js")>();
  class Connection {
    constructor() {
      return new Proxy({}, { get: (_t, p) => (fake.conn as Record<string | symbol, unknown>)[p] });
    }
  }
  return { ...real, Connection };
});

vi.mock("@macropaths/client", async (orig) => {
  const real = await orig<typeof import("@macropaths/client")>();
  const { clientFakes } = await import("./fakes");
  return { ...real, ...clientFakes };
});

import { STALE_MAX_MS, clearCache, retryConfig, RpcFailure } from "@/server/rpc";
import { clearTxCache } from "@/server/chain";
import { rpcMessage } from "@/server/errors";
import * as health from "@/app/api/health/route";
import * as session from "@/app/api/sessions/[addr]/route";

let conn: ReturnType<typeof makeFakeConnection>;
let now = 1_000_000;
beforeEach(() => {
  conn = makeFakeConnection();
  fake.conn = conn;
  clearCache();
  clearTxCache();
  retryConfig.baseMs = 1;
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const req = () => new Request("http://x/");
const RATE_LIMIT_BODY =
  '429 Too Many Requests:  {"jsonrpc":"2.0","error":{"code": 429, "message":"Connection rate limits exceeded"}, "id": "x" }';

describe("rpcMessage", () => {
  it("explains a rate limit and how to fix it", () => {
    const m = rpcMessage(new RpcFailure(`getAccountInfo: ${RATE_LIMIT_BODY}`));
    expect(m).toMatch(/rate-limiting/);
    expect(m).toMatch(/RPC_URL/);
  });
  it("names a malformed RPC_URL", () => {
    expect(rpcMessage(new RpcFailure("getSlot: Endpoint URL must start with `http:` or `https:`."))).toMatch(/RPC_URL is not a valid/);
  });
  it("names an unreachable endpoint", () => {
    expect(rpcMessage(new RpcFailure("getSlot: fetch failed"))).toMatch(/Could not reach/);
  });
  it("has a generic fallback that still points at RPC_URL", () => {
    expect(rpcMessage(new RpcFailure("getSlot: 500 boom"))).toMatch(/RPC_URL/);
  });
});

describe("rate-limited RPC", () => {
  it("returns a 502 rpc_error with a readable message and no raw provider text", async () => {
    conn.getAccountInfo.mockRejectedValue(new Error(RATE_LIMIT_BODY));
    const res = await session.GET(req(), params({ addr: SESSION_A }));
    expect(res.status).toBe(502);
    const body = ApiError.parse(await res.json());
    expect(body.code).toBe("rpc_error");
    expect(body.error).toMatch(/rate-limiting requests \(HTTP 429\)/);
    expect(body.error).not.toMatch(/jsonrpc|Connection rate limits exceeded/);
  });

  it("serves the last good session read while the refresh is rate-limited", async () => {
    const ok = await session.GET(req(), params({ addr: SESSION_A }));
    expect(ok.status).toBe(200);
    const first = SessionView.parse(await ok.json());
    now += 61_000; // past the 60 s TTL of a settled session
    conn.getAccountInfo.mockRejectedValue(new Error(RATE_LIMIT_BODY));
    const res = await session.GET(req(), params({ addr: SESSION_A }));
    expect(res.status).toBe(200);
    expect(SessionView.parse(await res.json())).toEqual(first);
    expect(conn.getAccountInfo).toHaveBeenCalledTimes(1 + retryConfig.attempts); // first read, then a refresh that retried the 429 and gave up
  });

  it("stops serving a stale read after STALE_MAX_MS", async () => {
    await session.GET(req(), params({ addr: SESSION_A }));
    now += 60_000 + STALE_MAX_MS + 1;
    conn.getAccountInfo.mockRejectedValue(new Error(RATE_LIMIT_BODY));
    expect((await session.GET(req(), params({ addr: SESSION_A }))).status).toBe(502);
  });

  it("does not hide a 404 behind a stale read", async () => {
    await session.GET(req(), params({ addr: SESSION_A }));
    now += 61_000;
    conn.getAccountInfo.mockResolvedValue(null);
    expect((await session.GET(req(), params({ addr: SESSION_A }))).status).toBe(404);
  });
});

describe("GET /api/health", () => {
  it("shares one pair of RPC calls between pollers inside the TTL", async () => {
    await health.GET();
    await health.GET();
    expect(conn.getSlot).toHaveBeenCalledTimes(1);
    expect(conn.getAccountInfo).toHaveBeenCalledTimes(1);
  });
  it("never reports a stale slot when the RPC fails", async () => {
    expect((await health.GET()).status).toBe(200);
    now += 5_000;
    conn.getSlot.mockRejectedValue(new Error(RATE_LIMIT_BODY));
    const res = await health.GET();
    expect(res.status).toBe(502);
    expect(ApiError.parse(await res.json()).error).toMatch(/rate-limiting/);
  });
});

describe("RPC_URL", () => {
  const saved = process.env.RPC_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.RPC_URL;
    else process.env.RPC_URL = saved;
  });
  it("falls back to public devnet when RPC_URL is unset or empty", async () => {
    for (const v of [undefined, ""]) {
      if (v === undefined) delete process.env.RPC_URL;
      else process.env.RPC_URL = v;
      vi.resetModules();
      const m = await import("@/server/rpc");
      expect(m.RPC_URL).toBe("https://api.devnet.solana.com");
    }
  });
  it("uses RPC_URL when set", async () => {
    process.env.RPC_URL = "https://example.invalid/rpc";
    vi.resetModules();
    expect((await import("@/server/rpc")).RPC_URL).toBe("https://example.invalid/rpc");
  });
});
