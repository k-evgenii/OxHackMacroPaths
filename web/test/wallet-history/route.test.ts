import { describe, expect, it, vi } from "vitest";
import { key, sig } from "./builders";

const getWalletActivity = vi.fn();
vi.mock("@/server/wallet/activity", () => ({ DEFAULT_LIMIT: 10, MAX_LIMIT: 25, getWalletActivity }));
const { GET } = await import("@/app/api/wallet/[owner]/activity/route");

const OWNER = key(1);
const call = (qs: string, owner = OWNER) => GET(new Request(`http://x/api/wallet/${owner}/activity${qs}`), { params: Promise.resolve({ owner }) });
const empty = { items: [], nextBefore: null, pending: [], retryCursor: null };

describe("GET /api/wallet/[owner]/activity", () => {
  it("defaults limit to 10 and validates the response", async () => {
    getWalletActivity.mockResolvedValueOnce(empty);
    const res = await call("");
    expect(res.status).toBe(200);
    expect(getWalletActivity.mock.calls.at(-1)!.slice(0, 2)).toEqual([OWNER, { before: undefined, limit: 10 }]);
  });

  it("passes retryCursor alone and rejects mixing it with paging", async () => {
    getWalletActivity.mockResolvedValueOnce(empty);
    expect((await call("?retryCursor=abc")).status).toBe(200);
    expect(getWalletActivity.mock.calls.at(-1)![1]).toEqual({ retryCursor: "abc" });
    expect((await call("?retryCursor=abc&limit=5")).status).toBe(400);
  });

  it("rejects bad owner, limit and before", async () => {
    expect((await call("", "nope")).status).toBe(400);
    expect((await call("?limit=26")).status).toBe(400);
    expect((await call("?limit=0")).status).toBe(400);
    expect((await call("?before=xyz")).status).toBe(400);
    getWalletActivity.mockResolvedValueOnce(empty);
    expect((await call(`?before=${sig(5)}&limit=25`)).status).toBe(200);
  });

  it("a response violating the contract becomes 500", async () => {
    getWalletActivity.mockResolvedValueOnce({ ...empty, items: [{ id: 1 }] });
    expect((await call("")).status).toBe(500);
  });
});
