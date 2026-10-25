import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { WalletConnectionController, findInjectedWallet, type InjectedWallet } from "./controller";
import { clearOwnerQueries } from "./WalletConnectionProvider";

const A = "EuUN3PSjtV5bp1nY2JoFjPSCGxJjAXPMx7TA2kKSwgmy";
const B = "GGj85c2FS3Ku5zQWNaRqaz8wyZ1aV8bkwio2FAYU7AUw";

function fakeWallet(key = A) {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  let resolveConnect: ((v: unknown) => void) | null = null;
  const w = {
    publicKey: null as { toString(): string } | null,
    connect: vi.fn(() => new Promise((r) => (resolveConnect = r)).then(() => {
      w.publicKey = { toString: () => key };
      return { publicKey: w.publicKey };
    })),
    disconnect: vi.fn(async () => undefined),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    on: (e: string, l: (...a: unknown[]) => void) => void (handlers[e] ??= []).push(l),
    off: (e: string, l: (...a: unknown[]) => void) => void (handlers[e] = (handlers[e] ?? []).filter((x) => x !== l)),
    emit: (e: string, ...a: unknown[]) => (handlers[e] ?? []).forEach((l) => l(...a)),
    approve: () => resolveConnect?.(undefined),
  };
  return w;
}

describe("WalletConnectionController", () => {
  it("connects to a public address without signing", async () => {
    const w = fakeWallet();
    const c = new WalletConnectionController(() => w as unknown as InjectedWallet);
    const p = c.connect("phantom");
    await Promise.resolve();
    expect(c.getSnapshot().status).toBe("connecting");
    w.approve();
    await p;
    expect(c.getSnapshot()).toMatchObject({ owner: A, status: "connected", wallet: "phantom" });
    expect(w.signMessage).not.toHaveBeenCalled();
    expect(w.signTransaction).not.toHaveBeenCalled();
  });

  it("reports an absent wallet", async () => {
    const c = new WalletConnectionController(() => null);
    await c.connect("solflare");
    expect(c.getSnapshot()).toMatchObject({ status: "error", owner: null });
    expect(c.getSnapshot().error).toMatch(/Solflare was not found/);
  });

  it("reports a rejection", async () => {
    const c = new WalletConnectionController(() => ({ connect: async () => Promise.reject({ code: 4001, message: "User rejected" }), disconnect: async () => undefined }));
    await c.connect("phantom");
    expect(c.getSnapshot().error).toMatch(/declined/);
  });

  it("discards a late connect after disconnect", async () => {
    const w = fakeWallet();
    const c = new WalletConnectionController(() => w as unknown as InjectedWallet);
    const p = c.connect("phantom");
    await Promise.resolve();
    await c.disconnect();
    w.approve();
    await p;
    expect(c.getSnapshot()).toMatchObject({ owner: null, status: "disconnected" });
  });

  it("account switch and disconnect notify owner change synchronously", async () => {
    const w = fakeWallet();
    const c = new WalletConnectionController(() => w as unknown as InjectedWallet);
    const changes: Array<[string, string | null]> = [];
    c.onOwnerChange((prev, next) => changes.push([prev, next]));
    const p = c.connect("phantom");
    await Promise.resolve();
    w.approve();
    await p;
    w.emit("accountChanged", { toString: () => B });
    expect(c.getSnapshot().owner).toBe(B);
    w.emit("disconnect");
    expect(c.getSnapshot().status).toBe("disconnected");
    expect(changes).toEqual([[A, B], [B, null]]);
  });

  it("finds injected Phantom and Solflare providers", () => {
    const ph = { isPhantom: true, connect: vi.fn(), disconnect: vi.fn() };
    const sf = { isSolflare: true, connect: vi.fn(), disconnect: vi.fn() };
    expect(findInjectedWallet("phantom", { phantom: { solana: ph } })).toBe(ph);
    expect(findInjectedWallet("solflare", { solflare: sf })).toBe(sf);
    expect(findInjectedWallet("phantom", {})).toBeNull();
  });
});

describe("clearOwnerQueries", () => {
  it("removes only the previous owner's data", () => {
    const client = new QueryClient();
    client.setQueryData(["wallet", A, "overview"], { x: 1 });
    client.setQueryData(["wallet", B, "overview"], { x: 2 });
    client.setQueryData(["catalog"], { c: 1 });
    clearOwnerQueries(client, A);
    expect(client.getQueryData(["wallet", A, "overview"])).toBeUndefined();
    expect(client.getQueryData(["wallet", B, "overview"])).toEqual({ x: 2 });
    expect(client.getQueryData(["catalog"])).toEqual({ c: 1 });
  });
});
