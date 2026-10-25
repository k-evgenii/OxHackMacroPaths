import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  ACCOUNT_DISCRIMINATORS,
  PROGRAM_ID,
  quotePda,
  sellerPda,
  type SessionView,
} from "@macropaths/client";
import sessionFixture from "@macropaths/client/fixtures/session-B89z.view.json";
import registryJson from "../../config/sessions.json";
import { buildCatalog } from "@/server/sessions/catalog";
import { parseRegistry, type Registry } from "@/server/sessions/registry";
import {
  SESSION_V1_SIZE,
  createSessionRepository,
  discoverV1SessionAccounts,
  type RpcReader,
  type SessionRepository,
} from "@/server/sessions/repository";
import {
  TOKEN_PROGRAM_ID,
  buildSessionOverview,
  currentScores,
  offerStatus,
  tokenAmount,
} from "@/server/sessions/overview";
import { HttpError } from "@/server/errors";
import { RpcFailure } from "@/server/rpc";

const A = "B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju";
const fixtures = path.resolve(__dirname, "../../../packages/client/fixtures");
const sessionBytes = Buffer.from(
  readFileSync(path.join(fixtures, "session-B89z.base64"), "utf8").trim(),
  "base64",
);
const registry = parseRegistry(registryJson);
const base = sessionFixture as unknown as SessionView;

const info = (data: Buffer, owner = PROGRAM_ID): AccountInfo<Buffer> => ({
  owner,
  data,
  executable: false,
  lamports: 1,
  rentEpoch: 0,
});

function fakeReader(
  accounts: Record<string, AccountInfo<Buffer> | null>,
  fail = new Set<string>(),
) {
  const conn = {
    getAccountInfo: vi.fn(
      async (k: PublicKey) => accounts[k.toBase58()] ?? null,
    ),
    getMultipleAccountsInfo: vi.fn(async (ks: PublicKey[]) =>
      ks.map((k) => accounts[k.toBase58()] ?? null),
    ),
    getProgramAccounts: vi.fn(async () => []),
  };
  const reader: RpcReader = {
    read: async (method, op) => {
      if (fail.has(method)) throw new RpcFailure(`${method}: boom`);
      return op(conn as never);
    },
  };
  return { reader, conn };
}

const repoWith = (
  accounts: Record<string, AccountInfo<Buffer> | null>,
  reg: Registry = registry,
) => {
  const f = fakeReader(accounts);
  return {
    ...f,
    repo: createSessionRepository({
      reader: f.reader,
      registry: reg,
      cache: false,
    }),
  };
};

const expectHttp = async (p: Promise<unknown>, code: string, re: RegExp) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(HttpError);
  expect((e as HttpError).code).toBe(code);
  expect((e as HttpError).message).toMatch(re);
};

describe("registry and catalog", () => {
  it("contains reference session A with its actual (non-p90) terms and dataset", () => {
    expect(registry.defaultSession).toBe(A);
    expect(registry.sessions.map((s) => s.address)).toEqual([A]);
    const a = registry.sessions[0];
    expect(a.terms).toEqual({ k: base.terms.k, dCap: "80000", aCap: "800000" });
    expect(a.datasetId).toBe(base.datasetId);
    expect(a.nObs).toBe(48);
    expect(a.firstPeriodId).toBe(base.path[0].periodId);
    expect(a.researchBundleId).toBeNull();
  });

  it("rejects invalid configurations", () => {
    expect(() =>
      parseRegistry({
        ...registryJson,
        defaultSession: "11111111111111111111111111111111",
      }),
    ).toThrow(/defaultSession/);
    expect(() =>
      parseRegistry({
        ...registryJson,
        sessions: [...registryJson.sessions, ...registryJson.sessions],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      parseRegistry({
        ...registryJson,
        sessions: [{ ...registryJson.sessions[0], layout: "v2" }],
      }),
    ).toThrow();
  });

  it("catalog loads offline from configuration (no RPC module touched)", () => {
    const c = buildCatalog(registry);
    expect(c).toMatchObject({
      version: 1,
      cluster: "devnet",
      defaultSession: A,
      research: {
        bundleId: "rb1-8635e8d7fee555a8",
        path: "/api/artifacts/bundle",
      },
    });
    expect(c.sessions).toEqual([
      {
        address: A,
        presentation: {
          label: "Reference session A",
          mode: "historical_replay",
          layout: "v1",
          firstPeriodId: 202101,
          researchBundleId: null,
        },
      },
    ]);
    expect(c.products.map((p) => [p.key, p.status, p.productIndex])).toEqual([
      ["cooling", "supported", 0],
      ["excess", "supported", 1],
      ["fuel", "research", null],
    ]);
  });
});

describe("session repository", () => {
  it("v1 fixture is 913 bytes", () =>
    expect(sessionBytes.length).toBe(SESSION_V1_SIZE));

  it("lists only configured sessions by direct read, never a program scan", async () => {
    const { repo, conn } = repoWith({ [A]: info(sessionBytes) });
    const list = await repo.listRegistered();
    expect(list.map((s) => s.address)).toEqual([A]);
    expect(conn.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    expect(conn.getProgramAccounts).not.toHaveBeenCalled();
    const one = await repo.get(A);
    expect(one.terms).toEqual({ k: "40000", dCap: "80000", aCap: "800000" });
    expect(conn.getProgramAccounts).not.toHaveBeenCalled();
  });

  it("unregistered and malformed addresses are rejected without RPC", async () => {
    const { repo, conn } = repoWith({});
    await expectHttp(
      repo.get("11111111111111111111111111111111"),
      "not_found",
      /not registered/,
    );
    await expectHttp(
      repo.get("not-a-key"),
      "bad_request",
      /invalid session address/,
    );
    expect(conn.getAccountInfo).not.toHaveBeenCalled();
  });

  it("missing, foreign-owned, wrong-layout and registry-mismatched accounts are explicit", async () => {
    await expectHttp(
      repoWith({}).repo.get(A),
      "not_found",
      /no MacroPaths session/,
    );
    await expectHttp(
      repoWith({ [A]: info(sessionBytes, TOKEN_PROGRAM_ID) }).repo.get(A),
      "internal",
      /not owned/,
    );
    await expectHttp(
      repoWith({
        [A]: info(Buffer.concat([sessionBytes, Buffer.alloc(8)])),
      }).repo.get(A),
      "internal",
      /unsupported layout/,
    );
    const notSession = Buffer.from(sessionBytes);
    Buffer.from(ACCOUNT_DISCRIMINATORS.Seller).copy(notSession, 0);
    await expectHttp(
      repoWith({ [A]: info(notSession) }).repo.get(A),
      "internal",
      /not a Session/,
    );
    const wrongDataset = {
      ...registry,
      sessions: [{ ...registry.sessions[0], datasetId: "00".repeat(32) }],
    };
    await expectHttp(
      repoWith({ [A]: info(sessionBytes) }, wrongDataset).repo.get(A),
      "internal",
      /dataset/,
    );
    const p90 = {
      ...registry,
      sessions: [
        {
          ...registry.sessions[0],
          terms: { k: "40000", dCap: "123456", aCap: "800000" },
        },
      ],
    };
    await expectHttp(
      repoWith({ [A]: info(sessionBytes) }, p90).repo.get(A),
      "internal",
      /terms/,
    );
    // listRegistered never silently omits a failing entry
    await expectHttp(
      repoWith({}).repo.listRegistered(),
      "not_found",
      /no MacroPaths session/,
    );
  });

  it("RPC failure propagates as RpcFailure (rpc_error), not not_found", async () => {
    const f = fakeReader(
      { [A]: info(sessionBytes) },
      new Set(["getAccountInfo"]),
    );
    const repo = createSessionRepository({
      reader: f.reader,
      registry,
      cache: false,
    });
    await expect(repo.get(A)).rejects.toBeInstanceOf(RpcFailure);
  });

  it("developer discovery filters by discriminator and v1 size 913", async () => {
    const { reader, conn } = fakeReader({});
    await discoverV1SessionAccounts(reader);
    const [pid, cfg] = conn.getProgramAccounts.mock.calls[0] as unknown as [
      PublicKey,
      { filters: unknown[] },
    ];
    expect(pid.equals(PROGRAM_ID)).toBe(true);
    expect(cfg.filters).toContainEqual({ dataSize: 913 });
    expect(cfg.filters[0]).toMatchObject({ memcmp: { offset: 0 } });
  });
});

// ---- overview -------------------------------------------------------------------------------

function tokenAccount(
  mint: string,
  authority: string,
  amount: bigint,
  state = 1,
): Buffer {
  const d = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(d, 0);
  new PublicKey(authority).toBuffer().copy(d, 32);
  d.writeBigUInt64LE(amount, 64);
  d[108] = state;
  return d;
}

function sellerBytes(freeCash: bigint): Buffer {
  // discriminator + session(32) + seller(32) + free_cash u64 + escrow[2] + n_sold[2] + premium[2] + settled[2] + bump
  const d = Buffer.alloc(8 + 32 + 32 + 8 + 16 + 16 + 16 + 2 + 2);
  Buffer.from(ACCOUNT_DISCRIMINATORS.Seller).copy(d, 0);
  new PublicKey(A).toBuffer().copy(d, 8);
  d.writeBigUInt64LE(freeCash, 72);
  return d;
}
function quoteBytes(isSet: boolean): Buffer {
  // discriminator + session(32) + p[2] u64 + is_set + frozen + bump
  const d = Buffer.alloc(8 + 32 + 16 + 3);
  Buffer.from(ACCOUNT_DISCRIMINATORS.EntryQuote).copy(d, 0);
  new PublicKey(A).toBuffer().copy(d, 8);
  d.writeBigUInt64LE(25_000n, 40);
  d.writeBigUInt64LE(30_000n, 48);
  d[56] = isSet ? 1 : 0;
  return d;
}

const key = new PublicKey(A);
const SELLER = sellerPda(key)[0].toBase58();
const QUOTE = quotePda(key)[0].toBase58();

type Overrides = {
  session?: Partial<SessionView>;
  vaults?: (AccountInfo<Buffer> | null)[];
  seller?: AccountInfo<Buffer> | null;
  quote?: AccountInfo<Buffer> | null;
  failVault?: boolean;
  failOffer?: boolean;
};

function overviewRepo(o: Overrides = {}): SessionRepository {
  const session = { ...base, ...o.session } as SessionView;
  const vaults = o.vaults ?? [
    info(tokenAccount(base.playMint, A, 60_000_000n), TOKEN_PROGRAM_ID),
    info(tokenAccount(base.playMint, A, 70_000_000n), TOKEN_PROGRAM_ID),
  ];
  return {
    listRegistered: async () => [session],
    get: async () => session,
    getManyAccounts: async (keys) => {
      const ids = keys.map((k) => k.toBase58());
      if (ids[0] === session.vaults[0]) {
        if (o.failVault) throw new RpcFailure("getMultipleAccountsInfo: boom");
        return vaults;
      }
      if (ids[0] === SELLER && ids[1] === QUOTE) {
        if (o.failOffer) throw new RpcFailure("getMultipleAccountsInfo: boom");
        return [
          o.seller === undefined ? null : o.seller,
          o.quote === undefined ? null : o.quote,
        ];
      }
      throw new Error(`unexpected keys ${ids}`);
    },
  };
}

const NOW = new Date((base.depositDeadline - 100) * 1000);
const overview = (
  o: Overrides = {},
  accrued = vi.fn(() => ["111", "222"] as [string, string]),
) =>
  buildSessionOverview(A, {
    repository: overviewRepo(o),
    registry,
    now: () => NOW,
    accrued,
  });

describe("session overview", () => {
  it("returns session, presentation, historical deposits and current vault balances", async () => {
    const r = await overview();
    expect(r.session.address).toBe(A);
    expect(r.meta).toEqual({ source: "rpc", fetchedAt: NOW.toISOString() });
    expect(r.presentation.label).toBe("Reference session A");
    expect(r.derived.poolDeposited).toBe("380000000");
    expect(r.vault).toEqual({
      status: "ok",
      data: { amounts: ["60000000", "70000000"], total: "130000000" },
    });
    expect(r.derived.currentScores).toEqual(base.scores); // Settled: final recorded scores
  });

  it("a claim lowers the current vault while total deposited stays fixed", async () => {
    const after = await overview({
      vaults: [
        info(tokenAccount(base.playMint, A, 10_000_000n), TOKEN_PROGRAM_ID),
        info(tokenAccount(base.playMint, A, 70_000_000n), TOKEN_PROGRAM_ID),
      ],
      session: { counts: { ...base.counts, claimed: 1 } },
    });
    expect(after.vault.data?.total).toBe("80000000");
    expect(after.derived.poolDeposited).toBe("380000000");
    expect(after.session.counts.claimed).toBe(1);
  });

  it("rejects token accounts with wrong mint, authority, program or state", () => {
    const good = tokenAccount(base.playMint, A, 5n);
    expect(tokenAmount(info(good, TOKEN_PROGRAM_ID), base.playMint, A)).toBe(
      5n,
    );
    expect(tokenAmount(info(good, PROGRAM_ID), base.playMint, A)).toBeNull();
    expect(
      tokenAmount(
        info(tokenAccount(A, A, 5n), TOKEN_PROGRAM_ID),
        base.playMint,
        A,
      ),
    ).toBeNull();
    expect(
      tokenAmount(
        info(tokenAccount(base.playMint, base.authority, 5n), TOKEN_PROGRAM_ID),
        base.playMint,
        A,
      ),
    ).toBeNull();
    expect(
      tokenAmount(
        info(tokenAccount(base.playMint, A, 5n, 2), TOKEN_PROGRAM_ID),
        base.playMint,
        A,
      ),
    ).toBeNull();
    expect(tokenAmount(null, base.playMint, A)).toBeNull();
  });

  it("invalid vault token account makes the vault section unavailable, never zero", async () => {
    const r = await overview({
      vaults: [
        info(tokenAccount(A, A, 1n), TOKEN_PROGRAM_ID),
        info(tokenAccount(base.playMint, A, 1n), TOKEN_PROGRAM_ID),
      ],
    });
    expect(r.vault).toEqual({ status: "unavailable", data: null });
  });

  it("keeps required session data when optional vault and seller reads fail", async () => {
    const r = await overview({ failVault: true, failOffer: true });
    expect(r.session.address).toBe(A);
    expect(r.derived.poolDeposited).toBe("380000000");
    expect(r.vault).toEqual({ status: "unavailable", data: null });
    expect(r.coverOffer).toEqual({ status: "unavailable", data: null });
  });

  it("missing seller differs from failed seller read", async () => {
    const open = { state: "Open" as const, nextIndex: 0 };
    const missing = await overview({ session: open });
    expect(missing.coverOffer).toEqual({
      status: "ok",
      data: { seller: null, quote: null, status: "not_configured" },
    });
    const failed = await overview({ session: open, failOffer: true });
    expect(failed.coverOffer.status).toBe("unavailable");
    const foreign = await overview({
      session: open,
      seller: info(sellerBytes(1n), TOKEN_PROGRAM_ID),
    });
    expect(foreign.coverOffer.status).toBe("unavailable");
  });

  it("offer states follow session, deadline and seller data", async () => {
    const open = { state: "Open" as const, nextIndex: 0 };
    const funded = {
      seller: info(sellerBytes(5_000_000n)),
      quote: info(quoteBytes(true)),
    };
    expect(
      (await overview({ session: open, ...funded })).coverOffer.data?.status,
    ).toBe("available");
    expect(
      (
        await overview({
          session: open,
          seller: info(sellerBytes(0n)),
          quote: info(quoteBytes(true)),
        })
      ).coverOffer.data?.status,
    ).toBe("unfunded");
    expect(
      (
        await overview({
          session: open,
          seller: info(sellerBytes(1n)),
          quote: info(quoteBytes(false)),
        })
      ).coverOffer.data?.status,
    ).toBe("not_configured");
    const closed = await overview({ ...funded });
    expect(closed.coverOffer.data?.status).toBe("closed"); // Settled: historical quote, not purchasable
    expect(closed.coverOffer.data?.quote?.p).toEqual(["25000", "30000"]);
    const s = { ...base, ...open } as SessionView;
    const seller = { freeCash: "1" } as never;
    const quote = { isSet: true } as never;
    expect(offerStatus(s, seller, quote, s.depositDeadline)).toBe("closed"); // deadline reached
    expect(offerStatus(s, seller, quote, s.depositDeadline - 1)).toBe(
      "available",
    );
    expect(offerStatus({ ...s, state: "Running" }, seller, quote, 0)).toBe(
      "closed",
    );
  });

  it("accrued scores: shared helper while Running, none before observations, null when Refunding", async () => {
    const accrued = vi.fn(() => ["5", "6"] as [string, string]);
    const running = { ...base, state: "Running", nextIndex: 12 } as SessionView;
    expect(currentScores(running, accrued)).toEqual(["5", "6"]);
    expect(accrued).toHaveBeenCalledWith(running);
    expect(currentScores({ ...running, nextIndex: 0 }, accrued)).toBeNull();
    expect(
      currentScores(
        { ...base, state: "Open", nextIndex: 0 } as SessionView,
        accrued,
      ),
    ).toBeNull();
    expect(
      currentScores({ ...base, state: "Refunding" } as SessionView, accrued),
    ).toBeNull();
    // A Running session whose commitment has not reached terminal keeps raw integrityOk=false, not an error.
    const r = await overview(
      { session: { state: "Running", nextIndex: 12, integrityOk: false } },
      accrued,
    );
    expect(r.session.integrityOk).toBe(false);
    expect(r.derived.currentScores).toEqual(["5", "6"]);
  });

  it("final-state counters stay refreshable (repository TTL is finite and short)", async () => {
    const { sessionTtlMs } = await import("@/server/sessions/repository");
    expect(sessionTtlMs("Settled")).toBeLessThanOrEqual(30_000);
    expect(sessionTtlMs("Refunding")).toBeLessThanOrEqual(30_000);
    // Live account reads are uncached: two calls hit RPC twice.
    const { repo, conn } = repoWith({ [A]: info(sessionBytes) });
    await repo.getManyAccounts([key]);
    await repo.getManyAccounts([key]);
    expect(conn.getMultipleAccountsInfo).toHaveBeenCalledTimes(2);
  });

  it("required session failure surfaces as the typed route error", async () => {
    const repo: SessionRepository = {
      ...overviewRepo(),
      get: async () => {
        throw new HttpError("not_found", "session x is not registered");
      },
    };
    await expect(
      buildSessionOverview(A, { repository: repo, registry }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
