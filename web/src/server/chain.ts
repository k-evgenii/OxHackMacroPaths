// Read helpers used by the API routes. All RPC goes through rpc.ts.
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { BorshCoder } from "@anchor-lang/core";
import {
  IDL,
  PROGRAM_ID,
  SESSION_FIELD_OFFSET,
  accountKind,
  parseEvents,
  type AccountKind,
  type EventView,
  type SessionView,
} from "@macropaths/client";
import { cached, mapLimit, rpc } from "./rpc";
import { badRequest } from "./errors";
import { SESSION_V1_SIZE as SESSION_V1_SIZE_VALUE, discoverV1SessionAccounts, legacyReader, sessionTtlMs } from "./sessions/repository";
import { sessionRepository } from "./sessions";

const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

// Account reads (Agent 04) live in ./sessions; re-exported here for existing importers.
export { parsePubkey, ownAccount, SESSION_V1_SIZE } from "./sessions/repository";

export function parseSignature(s: string): string {
  if (!SIGNATURE_RE.test(s)) throw badRequest("invalid before: not a base58 transaction signature");
  return s;
}

/** Legacy TTL used by the session events helpers below. */
export const ttlFor = (state: SessionView["state"]) => (state === "Settled" || state === "Refunding" ? 60_000 : 5_000);

/** A registered, registry-validated session (unregistered addresses are 404). */
export function getSessionView(address: string): Promise<SessionView> {
  return sessionRepository.get(address);
}

export type RawAccount = { address: string; data: Uint8Array };

/** Byte length of a v1 Session account (discriminator + fields). */
export const SESSION_ACCOUNT_SIZE = SESSION_V1_SIZE_VALUE;

/** Developer-only broad discovery of v1 sessions (discriminator + dataSize 913). */
export async function listSessionAccounts(): Promise<RawAccount[]> {
  return cached("sessions", 5_000, () => discoverV1SessionAccounts(legacyReader));
}

/** Program accounts whose `session` field equals this session (Position, Cover, Seller, EntryQuote). */
export async function listSessionChildren(session: SessionView): Promise<(RawAccount & { kind: AccountKind | null })[]> {
  return cached(`children:${session.address}`, sessionTtlMs(session.state), async () => {
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

/** Uncached multi-account read: balances and counters are mutable in every state. */
export async function getAccounts(_session: SessionView, keys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
  return sessionRepository.getManyAccounts(keys);
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

async function eventsForSignature(signature: string, session: string): Promise<EventView[]> {
  const key = `${session}:${signature}`;
  const hit = txEvents.get(key);
  if (hit) return hit;
  const tx = await rpc("getTransaction", (c) =>
    c.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }),
  );
  if (!tx) return []; // not yet visible at "confirmed"; retry on a later request
  const events =
    tx.meta && !tx.meta.err
      ? parseEvents(logsForSession(tx.meta.logMessages ?? [], session), { signature, slot: tx.slot, blockTime: tx.blockTime ?? null })
      : [];
  txEvents.set(key, events);
  return events;
}

export async function getSessionEvents(
  session: SessionView,
  opts: { before?: string; limit: number },
): Promise<{ events: EventView[]; nextBefore: string | null }> {
  const key = new PublicKey(session.address);
  const sigs = await cached(`sigs:${session.address}:${opts.before ?? ""}:${opts.limit}`, ttlFor(session.state), () =>
    rpc("getSignaturesForAddress", (c) =>
      c.getSignaturesForAddress(key, { before: opts.before, limit: opts.limit }, "confirmed"),
    ),
  );
  const perTx = await mapLimit(sigs, TX_CONCURRENCY, (s) => eventsForSignature(s.signature, session.address));
  return {
    events: perTx.flat(),
    nextBefore: sigs.length === opts.limit ? sigs[sigs.length - 1].signature : null,
  };
}
