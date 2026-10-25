import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const Schema = z.object({ n: z.number() });

async function load(fixtures: boolean) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", fixtures ? "1" : "0");
  return import("@/lib/api-client");
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchJson (live mode)", () => {
  it("validates with the schema and passes the AbortSignal to fetch", async () => {
    const { fetchJson } = await load(false);
    const fetchMock = vi.fn(async () => respond({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    await expect(fetchJson("/api/x", Schema, { signal: ctrl.signal })).resolves.toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", expect.objectContaining({ signal: ctrl.signal }));
  });

  it("keeps the two-argument signature", async () => {
    const { fetchJson } = await load(false);
    vi.stubGlobal("fetch", vi.fn(async () => respond({ n: 2 })));
    await expect(fetchJson("/api/x", Schema)).resolves.toEqual({ n: 2 });
  });

  it("normalizes schema failures without dumping zod issues", async () => {
    const { fetchJson, ApiRequestError } = await load(false);
    vi.stubGlobal("fetch", vi.fn(async () => respond({ n: "nope" })));
    const err = await fetchJson("/api/x?a=1", Schema).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("internal");
    expect(err.message).toBe("Unexpected data format from /api/x (n: Expected number, received string).");
  });

  it("normalizes API errors { error, code } and network failures", async () => {
    const { fetchJson, ApiRequestError, describeError } = await load(false);
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: "upstream", code: "rpc_error" }, 502)));
    const e1 = await fetchJson("/api/x", Schema).catch((e) => e);
    expect(e1).toMatchObject({ status: 502, code: "rpc_error" });
    expect(describeError(e1)).toMatch(/temporarily unavailable/);

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch https://secret-rpc"))));
    const e2 = await fetchJson("/api/x", Schema).catch((e) => e);
    expect(e2).toBeInstanceOf(ApiRequestError);
    expect(e2.status).toBe(0);
    expect(describeError(e2)).not.toMatch(/secret/);
  });

  it("rethrows aborts unchanged", async () => {
    const { fetchJson } = await load(false);
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      ctrl.abort();
      throw new DOMException("aborted", "AbortError");
    }));
    const err = await fetchJson("/api/x", Schema, { signal: ctrl.signal }).catch((e) => e);
    expect(err.name).toBe("AbortError");
  });

  it("never falls back to fixtures after a live failure", async () => {
    const { fetchJson } = await load(false);
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: "x", code: "rpc_error" }, 502)));
    const { CatalogResponse } = await import("@macropaths/client/types");
    await expect(fetchJson("/api/catalog", CatalogResponse)).rejects.toMatchObject({ status: 502 });
  });
});

// First dynamic import of the fixture router transforms all fixture JSON (slow on /mnt).
describe("fetchJson (fixture mode)", { timeout: 60_000 }, () => {
  it("answers client endpoints without network", async () => {
    const { fetchJson } = await load(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { CatalogResponse } = await import("@macropaths/client/types");
    const c = await fetchJson("/api/catalog", CatalogResponse);
    expect(c.sessions.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces fixture errors and unknown endpoints as errors (no network)", async () => {
    const { fetchJson } = await load(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("/api/wallet/bad", Schema)).rejects.toMatchObject({ status: 400, code: "bad_request" });
    await expect(fetchJson("/api/nothing", Schema)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
