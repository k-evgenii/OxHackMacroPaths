// Read helpers used by the API routes. All RPC goes through rpc.ts.
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { BorshAccountsCoder, BorshCoder, utils } from "@anchor-lang/core";
import {
  ACCOUNT_DISCRIMINATORS,
  IDL,
  PROGRAM_ID,
  SESSION_FIELD_OFFSET,
  accountKind,
  parseEvents,
  toSessionView,
  type AccountKind,
  type EventView,
  type SessionView,
} from "@macropaths/client";
import { cached, mapLimit, rpc } from "./rpc";
import { badRequest, notFound } from "./errors";

const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

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

export function parseSignature(s: string): string {
  if (!SIGNATURE_RE.test(s)) throw badRequest("invalid before: not a base58 transaction signature");
  return s;
}

/** 5 s while a session can still change, 60 s once it is final. */
export const ttlFor = (state: SessionView["state"]) => (state === "Settled" || state === "Refunding" ? 60_000 : 5_000);

/** Our account of the given kind, or null if missing / foreign-owned / other discriminator. */
export function ownAccount(info: AccountInfo<Buffer> | null, kind: AccountKind): Uint8Array | null {
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  const data = new Uint8Array(info.data);
  return accountKind(data) === kind ? data : null;
}

export async function getSessionView(address: string): Promise<SessionView> {
  const key = parsePubkey(address, "session address");
  return cached(
    `session:${address}`,
    (v: SessionView) => ttlFor(v.state),
    async () => {
      const info = await rpc("getAccountInfo", (c) => c.getAccountInfo(key));
      const data = ownAccount(info, "Session");
      if (!data) throw notFound(`no MacroPaths session at ${address}`);
      return toSessionView(address, data);
    },
  );
}

export type RawAccount = { address: string; data: Uint8Array };

/** Byte length of a Session account (discriminator + fields), from the IDL. */
export const SESSION_ACCOUNT_SIZE = new BorshAccountsCoder(IDL).size("Session");

export async function listSessionAccounts(): Promise<RawAccount[]> {
  return cached("sessions", 5_000, async () => {
    const accounts = await rpc("getProgramAccounts", (c) =>
      c.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(ACCOUNT_DISCRIMINATORS.Session) } },
          { dataSize: SESSION_ACCOUNT_SIZE },
        ],
      }),
    );
    return accounts.map((a) => ({ address: a.pubkey.toBase58(), data: new Uint8Array(a.account.data) }));
  });
}

/** Program accounts whose `session` field equals this session (Position, Cover, Seller, EntryQuote). */
export async function listSessionChildren(session: SessionView): Promise<(RawAccount & { kind: AccountKind | null })[]> {
  return cached(`children:${session.address}`, ttlFor(session.state), async () => {
    const accounts = await rpc("getProgramAccounts", (c) =>
      c.getProgramAccounts(PROGRAM_ID, {
        filters: [{ memcmp: { offset: SESSION_FIELD_OFFSET, bytes: session.address } }],
      }),
    );
    return accounts.map((a) => {
      const data = new Uint8Array(a.account.data);
      return { address: a.pubkey.toBase58(), data, kind: accountKind(data) };
    });
  });
}

export async function getAccounts(session: SessionView, keys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
  const ids = keys.map((k) => k.toBase58());
  return cached(`multi:${ids.join(",")}`, ttlFor(session.state), () =>
    rpc("getMultipleAccountsInfo", (c) => c.getMultipleAccountsInfo(keys)),
  );
}

// Transactions are immutable once confirmed: cache parsed events by (session, signature) forever.
const txEvents = new Map<string, EventView[]>();
export const TX_CONCURRENCY = 4;

export function clearTxCache(): void {
  txEvents.clear();
}

const eventCoder = new BorshCoder(IDL).events;
const PROGRAM_DATA = "Program data: ";

/**
 * Drop event logs whose `session` field names another session: one transaction can touch several
 * sessions, and getSignaturesForAddress returns it for each. Logs without a session field are kept.
 */
export function logsForSession(logs: string[], session: string): string[] {
  return logs.filter((log) => {
    if (!log.startsWith(PROGRAM_DATA)) return true;
    let field: { toBase58?: () => string } | undefined;
    try {
      field = (eventCoder.decode(log.slice(PROGRAM_DATA.length))?.data as { session?: typeof field } | undefined)?.session;
    } catch {
      return true; // not one of our events; parseEvents decides
    }
    return typeof field?.toBase58 !== "function" || field.toBase58() === session;
  });
}

/** null = transaction not yet visible at "confirmed" (reported as pending, retried on a later request). */
async function eventsForSignature(signature: string, session: string): Promise<EventView[] | null> {
  const key = `${session}:${signature}`;
  const hit = txEvents.get(key);
  if (hit) return hit;
  const tx = await rpc("getTransaction", (c) =>
    c.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }),
  );
  if (!tx) return null;
  // Parse every event first so eventIndex counts all MacroPaths events of the transaction, then keep
  // only those whose emitted `session` is the requested one (frontend v2 event identity).
  const events =
    tx.meta && !tx.meta.err
      ? parseEvents(tx.meta.logMessages ?? [], { signature, slot: tx.slot, blockTime: tx.blockTime ?? null }).filter(
          (e) => e.session === session,
        )
      : [];
  txEvents.set(key, events);
  return events;
}

export async function getSessionEvents(
  session: SessionView,
  opts: { before?: string; limit: number },
): Promise<{ events: EventView[]; nextBefore: string | null; pending: string[]; retryCursor: string | null }> {
  const key = new PublicKey(session.address);
  const sigs = await cached(`sigs:${session.address}:${opts.before ?? ""}:${opts.limit}`, ttlFor(session.state), () =>
    rpc("getSignaturesForAddress", (c) =>
      c.getSignaturesForAddress(key, { before: opts.before, limit: opts.limit }, "confirmed"),
    ),
  );
  const perTx = await mapLimit(sigs, TX_CONCURRENCY, (s) => eventsForSignature(s.signature, session.address));
  return {
    events: perTx.flatMap((e) => e ?? []),
    nextBefore: sigs.length === opts.limit ? sigs[sigs.length - 1].signature : null,
    // Legacy route: no snapshot store yet (worker 03), so pending signatures carry no retry token.
    pending: sigs.filter((_, i) => perTx[i] === null).map((s) => s.signature),
    retryCursor: null,
  };
}
