// Raw session events built from normalized repository transactions.
import { BorshCoder } from "@anchor-lang/core";
import { IDL, parseEvents, type EventView } from "@macropaths/client";
import type { HistoryPage, HistoryPageRequest, HistoryTransaction, RpcContext, TransactionRepository } from "./types";

/** EventView extended with the frozen `session`/`eventIndex` base fields. */
export type SessionEvent = EventView & { session: string; eventIndex: number };
export type SessionEventsPage = Omit<HistoryPage, "transactions"> & { events: SessionEvent[] };

const PROGRAM_DATA = "Program data: ";
const eventCoder = new BorshCoder(IDL).events;

/** Session field of each MacroPaths event log, in log order (null when the event has none). */
function sessionsInLogOrder(logs: string[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (const log of logs) {
    if (!log.startsWith(PROGRAM_DATA)) continue;
    let decoded: { data?: { session?: { toBase58?: () => string } } } | null = null;
    try {
      decoded = eventCoder.decode(log.slice(PROGRAM_DATA.length)) as typeof decoded;
    } catch {
      decoded = null;
    }
    if (!decoded) continue;
    const s = decoded.data?.session;
    out.push(typeof s?.toBase58 === "function" ? s.toBase58() : null);
  }
  return out;
}

/**
 * All MacroPaths events of a transaction with `eventIndex` counted over every parsed event in
 * log order (including other sessions' events), then filtered to `session`.
 * A failed transaction is a known read with no successful events.
 */
export function eventsForSession(tx: HistoryTransaction, session: string): SessionEvent[] {
  if (tx.failed) return [];
  const parsed = parseEvents(tx.logs, { signature: tx.signature, slot: tx.slot, blockTime: tx.blockTime });
  const sessions = sessionsInLogOrder(tx.logs);
  return parsed
    .map((e, eventIndex) => {
      const own = (e as { session?: unknown }).session;
      const s = typeof own === "string" ? own : (sessions[eventIndex] ?? null);
      return { ...e, session: s, eventIndex };
    })
    .filter((e): e is SessionEvent => e.session === session);
}

export async function getSessionEventsPage(
  repository: TransactionRepository,
  session: string,
  request: HistoryPageRequest,
  context?: RpcContext,
): Promise<SessionEventsPage> {
  const page = await repository.page({ kind: "session", address: session }, request, context);
  return {
    events: page.transactions.flatMap((tx) => eventsForSession(tx, session)),
    nextBefore: page.nextBefore,
    pending: page.pending,
    retryCursor: page.retryCursor,
  };
}

/** Stable per-event identity: a signature alone is not unique. */
export const eventId = (e: { signature: string; eventIndex: number }) => `${e.signature}:${e.eventIndex}`;
