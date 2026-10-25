// Public wallet read: exact PLAY balances per registered mint and the wallet's own Position/Cover
// per registered session, read directly at their PDAs. No participant scans, no transaction history,
// no signatures, no writes.
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  PROGRAM_ID,
  accountKind,
  coverPda,
  decodeAccount,
  positionPda,
  toCoverView,
  toPositionView,
  type CoverView,
  type PositionView,
  type SessionView,
  WalletOverviewResponse,
} from "@macropaths/client";
import type { CacheStore, SessionRepository } from "@/server/contracts";
import { parsePubkey } from "@/server/chain";
import { rpc } from "@/server/rpc";

/** Classic SPL Token program. Only accounts owned by it count as standard PLAY token accounts. */
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/** getMultipleAccounts accepts at most 100 keys per call. */
export const ACCOUNT_BATCH = 100;
/** Mutable chain reads (balances, holdings of an unfinished session): short TTL, seconds. */
export const MUTABLE_TTL_S = 5;
/** Holdings of a Settled/Refunding session only change by a claim: still short, never indefinite. */
export const FINAL_TTL_S = 60;
const TOKEN_ACCOUNT_SIZE = 165;

type Holding = { position: PositionView | null; cover: CoverView | null };
type Section<T> = { status: "ok"; data: T } | { status: "unavailable"; data: null };
const unavailable = { status: "unavailable", data: null } as const;
const ok = <T>(data: T): Section<T> => ({ status: "ok", data });

export type TokenAccountRead = { pubkey: PublicKey; account: AccountInfo<Buffer> };

export type WalletOverviewDeps = {
  sessions: Pick<SessionRepository, "listRegistered" | "getManyAccounts">;
  /** Every token account of `owner` for `mint` (getTokenAccountsByOwner with a mint filter). Throws on RPC failure. */
  tokenAccounts(owner: PublicKey, mint: PublicKey): Promise<readonly TokenAccountRead[]>;
  cache?: CacheStore;
  cluster: string;
  now?: () => Date;
  warn?: (message: string) => void;
};

/** Thrown for an account-integrity mismatch; the holding becomes unavailable, never absent. */
export class IntegrityError extends Error {
  name = "IntegrityError";
}

/**
 * Validate and convert the account at a derived Position/Cover PDA. null = no account (successful
 * absence). Throws IntegrityError for a foreign program, wrong discriminator, or an embedded
 * session/owner that does not match the requested values.
 */
export function readHoldingAccount<K extends "Position" | "Cover">(
  kind: K,
  pda: PublicKey,
  info: AccountInfo<Buffer> | null,
  session: SessionView,
  owner: PublicKey,
): (K extends "Position" ? PositionView : CoverView) | null {
  if (info === null) return null;
  const at = `${kind} ${pda.toBase58()}`;
  if (!info.owner.equals(PROGRAM_ID)) throw new IntegrityError(`${at}: owned by a foreign program`);
  const data = new Uint8Array(info.data);
  if (accountKind(data) !== kind) throw new IntegrityError(`${at}: wrong account discriminator`);
  let raw: { session?: { toBase58(): string }; owner?: { toBase58(): string } };
  try {
    raw = decodeAccount(kind, data);
  } catch {
    throw new IntegrityError(`${at}: undecodable account data`);
  }
  if (raw.session?.toBase58() !== session.address) throw new IntegrityError(`${at}: embedded session mismatch`);
  if (raw.owner?.toBase58() !== owner.toBase58()) throw new IntegrityError(`${at}: embedded owner mismatch`);
  const view = kind === "Position" ? toPositionView(pda.toBase58(), data, session) : toCoverView(pda.toBase58(), data, session);
  if (view.owner !== owner.toBase58() || view.address !== pda.toBase58()) throw new IntegrityError(`${at}: view mismatch`);
  return view as never;
}

/**
 * Exact sum of the wallet's standard SPL token accounts for one mint. Each account must be a
 * classic Token account of this mint and owner; anything else is an integrity error, not a zero.
 */
export function sumTokenAccounts(owner: PublicKey, mint: PublicKey, accounts: readonly TokenAccountRead[]): string {
  let total = 0n;
  for (const { pubkey, account } of accounts) {
    const at = `token account ${pubkey.toBase58()}`;
    if (!account.owner.equals(TOKEN_PROGRAM_ID)) continue; // not a standard SPL token account
    const d = account.data;
    if (d.length < TOKEN_ACCOUNT_SIZE) throw new IntegrityError(`${at}: short data`);
    if (!new PublicKey(d.subarray(0, 32)).equals(mint)) throw new IntegrityError(`${at}: mint mismatch`);
    if (!new PublicKey(d.subarray(32, 64)).equals(owner)) throw new IntegrityError(`${at}: owner mismatch`);
    if (d[108] === 0) continue; // uninitialized
    total += d.readBigUInt64LE(64);
  }
  return total.toString();
}

const holdingTtl = (s: SessionView) => (s.state === "Settled" || s.state === "Refunding" ? FINAL_TTL_S : MUTABLE_TTL_S);

async function cacheGet<T>(cache: CacheStore | undefined, key: string): Promise<T | null> {
  if (!cache) return null;
  try {
    return await cache.get<T>(key);
  } catch {
    return null;
  }
}
async function cacheSet<T>(cache: CacheStore | undefined, key: string, value: T, ttl: number): Promise<void> {
  if (!cache) return;
  try {
    await cache.set(key, value, ttl);
  } catch {
    /* a cache write failure never fails a read */
  }
}

/** Build the wallet overview from injected ports. Registry failure propagates as an endpoint error. */
export async function readWalletOverview(ownerInput: string, deps: WalletOverviewDeps): Promise<WalletOverviewResponse> {
  const owner = parsePubkey(ownerInput, "owner");
  const ownerB58 = owner.toBase58();
  const warn = deps.warn ?? ((m: string) => console.warn(`[api] wallet ${m}`));
  const sessions = await deps.sessions.listRegistered();

  // Registered PLAY mints, distinct, in registry order.
  const mints: string[] = [];
  for (const s of sessions) if (!mints.includes(s.playMint)) mints.push(s.playMint);

  const balancesP = Promise.all(
    mints.map(async (mint) => {
      const key = `wallet:v1:${deps.cluster}:${ownerB58}:balance:${mint}`;
      const hit = await cacheGet<string>(deps.cache, key);
      if (hit !== null) return { mint, read: ok({ amount: hit }) };
      try {
        const mintKey = new PublicKey(mint);
        const amount = sumTokenAccounts(owner, mintKey, await deps.tokenAccounts(owner, mintKey));
        await cacheSet(deps.cache, key, amount, MUTABLE_TTL_S);
        return { mint, read: ok({ amount }) };
      } catch (e) {
        warn(`balance read failed for mint ${mint}: ${e instanceof Error ? e.name : "error"}`);
        return { mint, read: unavailable };
      }
    }),
  );

  // Holdings: two derived PDAs per session, read in bounded batches.
  const holdings: { sessionAddress: string; read: Section<Holding> }[] = sessions.map((s) => ({
    sessionAddress: s.address,
    read: unavailable,
  }));
  const pending: { i: number; position: PublicKey; cover: PublicKey }[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const hit = await cacheGet<Holding>(deps.cache, `wallet:v1:${deps.cluster}:${ownerB58}:holding:${s.address}`);
    if (hit !== null) {
      holdings[i].read = ok(hit);
      continue;
    }
    const sessionKey = new PublicKey(s.address);
    pending.push({ i, position: positionPda(sessionKey, owner)[0], cover: coverPda(sessionKey, owner)[0] });
  }
  const perBatch = ACCOUNT_BATCH / 2;
  for (let b = 0; b < pending.length; b += perBatch) {
    const chunk = pending.slice(b, b + perBatch);
    let infos: (AccountInfo<Buffer> | null)[];
    try {
      infos = await deps.sessions.getManyAccounts(chunk.flatMap((p) => [p.position, p.cover]));
      if (infos.length !== chunk.length * 2) throw new Error("account count mismatch");
    } catch (e) {
      warn(`holding batch read failed: ${e instanceof Error ? e.name : "error"}`);
      continue; // entries stay unavailable
    }
    for (let j = 0; j < chunk.length; j++) {
      const { i, position, cover } = chunk[j];
      const s = sessions[i];
      try {
        const holding: Holding = {
          position: readHoldingAccount("Position", position, infos[2 * j], s, owner),
          cover: readHoldingAccount("Cover", cover, infos[2 * j + 1], s, owner),
        };
        holdings[i].read = ok(holding);
        await cacheSet(deps.cache, `wallet:v1:${deps.cluster}:${ownerB58}:holding:${s.address}`, holding, holdingTtl(s));
      } catch (e) {
        warn(`holding unavailable for session ${s.address}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
  }

  return {
    owner: ownerB58,
    meta: { source: "rpc", fetchedAt: (deps.now?.() ?? new Date()).toISOString() },
    balances: await balancesP,
    holdings,
  };
}

/**
 * Fixture mode: the fixture owner's synthetic response, or an empty state for any other owner over
 * the same registered mint/session set. Never hands one owner's fixture holdings to another.
 */
export function fixtureWalletOverview(
  ownerInput: string,
  fixtures: readonly WalletOverviewResponse[],
  now: () => Date = () => new Date(),
): WalletOverviewResponse {
  const owner = parsePubkey(ownerInput, "owner").toBase58();
  const fetchedAt = now().toISOString();
  const match = fixtures.find((f) => f.owner === owner);
  if (match) return { ...match, meta: { source: "fixture", fetchedAt } };
  const base = fixtures[0];
  return {
    owner,
    meta: { source: "fixture", fetchedAt },
    balances: (base?.balances ?? []).map((b) => ({ mint: b.mint, read: { status: "ok", data: { amount: "0" } } })),
    holdings: (base?.holdings ?? []).map((h) => ({
      sessionAddress: h.sessionAddress,
      read: { status: "ok", data: { position: null, cover: null } },
    })),
  };
}

const defaultTokenAccounts = (owner: PublicKey, mint: PublicKey) =>
  rpc("getTokenAccountsByOwner", (c) => c.getTokenAccountsByOwner(owner, { mint }, "confirmed")).then((r) => r.value);

/** Frozen service signature. */
export async function getWalletOverview(owner: string): Promise<WalletOverviewResponse> {
  parsePubkey(owner, "owner"); // typed 400 before any repository or fixture access
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === "1") {
    // Synthetic foundation fixtures: the A-owned wallet and the empty owner. Any other owner gets
    // an empty state over the same registered mints/sessions (never the fixture owner's holdings).
    const [a, empty] = await Promise.all([
      import("@macropaths/client/fixtures/frontend-v2/wallet/a-owned.json"),
      import("@macropaths/client/fixtures/frontend-v2/wallet/empty-owner.json"),
    ]);
    const fixtures = [a.default, empty.default].map((f) => WalletOverviewResponse.parse(f));
    return fixtureWalletOverview(owner, fixtures);
  }
  const { sessionRepository } = await import("@/server/sessions");
  return readWalletOverview(owner, {
    sessions: sessionRepository,
    tokenAccounts: defaultTokenAccounts,
    cluster: process.env.NEXT_PUBLIC_CLUSTER || "devnet",
  });
}
