import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiRequestError, fetchJson } from "@/lib/api-client";

const reply = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
afterEach(() => vi.unstubAllGlobals());

const Schema = z.object({ rows: z.array(z.object({ period_id: z.number() })) });

describe("fetchJson", () => {
  it("returns parsed data", async () => {
    reply(200, { rows: [{ period_id: 202101 }] });
    await expect(fetchJson("/api/artifacts/forecast", Schema)).resolves.toEqual({ rows: [{ period_id: 202101 }] });
  });

  it("names the mismatching field instead of dumping the raw zod issue list", async () => {
    reply(200, { rows: [{ period_id: 202101 }, { period_id: null }] });
    const err = await fetchJson("/api/artifacts/forecast", Schema).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.message).toBe("Unexpected data format from /api/artifacts/forecast (rows.1.period_id: Expected number, received null).");
    expect(err.message).not.toContain('"code"');
  });

  it("surfaces the API error text, status and code", async () => {
    reply(502, { error: "The Solana RPC endpoint is rate-limiting requests (HTTP 429).", code: "rpc_error" });
    const err = await fetchJson("/api/sessions", Schema).catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: "rpc_error", message: expect.stringMatching(/rate-limiting/) });
  });
});
