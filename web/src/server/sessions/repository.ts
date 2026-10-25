// Registered-session account reads. Importable by wallet/history services without route handlers.
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { utils } from "@anchor-lang/core";
import { ACCOUNT_DISCRIMINATORS, PROGRAM_ID, accountKind, toSessionView, type AccountKind, type SessionView } from "@macropaths/client";
import { HttpError, badRequest, notFound } from "../errors";
import { cached, rpc } from "../rpc";
import { findRegistered, getRegistry, type Registry, type RegistrySession } from "./registry";

/** Frozen port (interfaces.md). Replaced by Agent 02's admitted reader at integration. */
export interface RpcReader {
  read<T>(method: string, op: (connection: Connection) => Promise<T>, context?: { signal?: AbortSignal; deadlineAt?: number }): Promise<T>;
}
export interface SessionRepository {
  listRegistered(): Promise<SessionView[]>;
  get(address: string): Promise<SessionView>;
  getManyAccounts(keys: readonly PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]>;
}

/** Byte length of a v1 Session account. Only v1 is supported; other layouts fail explicitly. */
export const SESSION_V1_SIZE = 913;

const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function parsePubkey(s: string, what = "address"): PublicKey {
  if (PUBKEY_RE.test(s)) {
    try {
      return new PublicKey(s);
    } catch {
      /* fall through */
    }
  }
  throw badRequest(`invalid ${what}: not a base58 public key`);
}

/** Our account of the given kind, or null if missing / foreign-owned / other discriminator. */
export function ownAccount(info: AccountInfo<Buffer> | null, kind: AccountKind): Uint8Array | null {
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  const data = new Uint8Array(info.data);
  return accountKind(data) === kind ? data : null;
}

/**
 * Mutable-read TTL (ms). Balances, claim counters and seller cash can change in every state,
 * so final sessions are refreshed too; they are never cached permanently.
 */
export const sessionTtlMs = (state: SessionView["state"]) => (state === "Settled" || state === "Refunding" ? 30_000 : 5_000);

/** Session account failed registry validation: a configuration/chain mismatch, never silently omitted. */
const invalid = (address: string, why: string) => new HttpError("internal", `registered session ${address}: ${why}`);

/** Decode and validate a registered session account against its registry entry. */
export function validateSessionAccount(entry: RegistrySession, info: AccountInfo<Buffer> | null): SessionView {
  const a = entry.address;
  if (!info) throw notFound(`no MacroPaths session at ${a}`);
  if (!info.owner.equals(PROGRAM_ID)) throw invalid(a, "account is not owned by the MacroPaths program");
  const data = new Uint8Array(info.data);
  if (accountKind(data) !== "Session") throw invalid(a, "account is not a Session");
  if (data.length !== SESSION_V1_SIZE) throw invalid(a, `unsupported layout (${data.length} bytes, expected v1 ${SESSION_V1_SIZE})`);
  let v: SessionView;
  try {
    v = toSessionView(a, data);
  } catch {
    throw invalid(a, "account could not be decoded as a v1 Session");
  }
  if (v.datasetId !== entry.datasetId) throw invalid(a, "dataset does not match the registry");
  if (v.nObs !== entry.nObs) throw invalid(a, "observation count does not match the registry");
  if (v.terms.k !== entry.terms.k || v.terms.dCap !== entry.terms.dCap || v.terms.aCap !== entry.terms.aCap)
    throw invalid(a, "terms do not match the registry");
  return v;
}

export type SessionRepositoryDeps = { reader: RpcReader; registry: Registry; cache?: boolean };

export function createSessionRepository({ reader, registry, cache = true }: SessionRepositoryDeps): SessionRepository {
  const memo = <T>(key: string, ttl: (v: T) => number, fn: () => Promise<T>) => (cache ? cached(key, ttl, fn) : fn());

  const entryFor = (address: string): RegistrySession => {
    parsePubkey(address, "session address");
    const e = findRegistered(registry, address);
    if (!e) throw notFound(`session ${address} is not registered`);
    return e;
  };

  const readSessions = async (entries: RegistrySession[]): Promise<SessionView[]> => {
    const keys = entries.map((e) => new PublicKey(e.address));
    const infos = await reader.read("getMultipleAccountsInfo", (c) => c.getMultipleAccountsInfo(keys));
    return entries.map((e, i) => validateSessionAccount(e, infos[i] ?? null));
  };

  return {
    async get(address) {
      const entry = entryFor(address);
      return memo(`session:${address}`, (v: SessionView) => sessionTtlMs(v.state), async () => {
        const info = await reader.read("getAccountInfo", (c) => c.getAccountInfo(new PublicKey(address)));
        return validateSessionAccount(entry, info);
      });
    },
    async listRegistered() {
      return memo(
        "sessions:registered",
        (vs: SessionView[]) => Math.min(...vs.map((v) => sessionTtlMs(v.state))),
        () => readSessions(registry.sessions),
      );
    },
    async getManyAccounts(keys) {
      if (keys.length === 0) return [];
      // Uncached: callers read live balances/counters.
      return reader.read("getMultipleAccountsInfo", (c) => c.getMultipleAccountsInfo([...keys]));
    },
  };
}

/** Legacy transport adapter until Agent 02's createRpcReader lands. */
export const legacyReader: RpcReader = { read: (method, op) => rpc(method, op) };

/**
 * Developer-only broad discovery of v1 sessions (discriminator + dataSize 913).
 * Never used for client reads; does not imply support for other layouts.
 */
export async function discoverV1SessionAccounts(reader: RpcReader): Promise<{ address: string; data: Uint8Array }[]> {
  const accounts = await reader.read("getProgramAccounts", (c) =>
    c.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(ACCOUNT_DISCRIMINATORS.Session) } },
        { dataSize: SESSION_V1_SIZE },
      ],
    }),
  );
  return accounts.map((a) => ({ address: a.pubkey.toBase58(), data: new Uint8Array(a.account.data) }));
}

let defaultRepo: SessionRepository | undefined;
export function getDefaultSessionRepository(): SessionRepository {
  defaultRepo ??= createSessionRepository({ reader: legacyReader, registry: getRegistry() });
  return defaultRepo;
}
