// One transaction can emit events for several sessions; the events route must keep only the requested one.
// Uses the real @macropaths/client parser so the event's `session` field is actually decoded.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { EventsResponse, IDL, PROGRAM_ID } from "@macropaths/client";
import { SESSION_A, makeFakeConnection } from "./fakes";

const fake = vi.hoisted(() => ({ conn: undefined as unknown }));

vi.mock("@solana/web3.js", async (orig) => {
  const real = await orig<typeof import("@solana/web3.js")>();
  class Connection {
    constructor() {
      return new Proxy({}, { get: (_t, p) => (fake.conn as Record<string | symbol, unknown>)[p] });
    }
  }
  return { ...real, Connection };
});

import { clearCache, retryConfig } from "@/server/rpc";
import { clearTxCache } from "@/server/chain";
import * as events from "@/app/api/sessions/[addr]/events/route";

const SESSION_B = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
const OWNER_A = new PublicKey(new Uint8Array(32).fill(5)).toBase58();
const OWNER_B = new PublicKey(new Uint8Array(32).fill(6)).toBase58();
const SIG_A = "4".repeat(87);
const SIG_B = "5".repeat(87);
const PID = PROGRAM_ID.toBase58();

/** `Program data:` log line for Claimed{session, owner, amounts: [1, 2], refund: true}, borsh-encoded as the program emits it. */
function claimedLog(session: string, owner: string): string {
  const disc = IDL.events!.find((e) => e.name === "Claimed")!.discriminator;
  const amounts = Buffer.alloc(16);
  amounts.writeBigUInt64LE(1n, 0);
  amounts.writeBigUInt64LE(2n, 8);
  const body = Buffer.concat([
    Buffer.from(disc),
    new PublicKey(session).toBuffer(),
    new PublicKey(owner).toBuffer(),
    amounts,
    Buffer.from([1]),
  ]);
  return `Program data: ${body.toString("base64")}`;
}
const txLogs = (eventLog: string) => [`Program ${PID} invoke [1]`, "Program log: Instruction: Claim", eventLog, `Program ${PID} success`];

let conn: ReturnType<typeof makeFakeConnection>;
beforeEach(() => {
  conn = makeFakeConnection();
  fake.conn = conn;
  clearCache();
  clearTxCache();
  retryConfig.baseMs = 1;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const sig = (signature: string, slot: number) => ({ signature, slot, blockTime: 1_700_000_000, err: null, memo: null });
  conn.getSignaturesForAddress.mockResolvedValue([sig(SIG_A, 20), sig(SIG_B, 10)]);
  conn.getTransaction.mockImplementation(async (s: string) => ({
    slot: s === SIG_A ? 20 : 10,
    blockTime: 1_700_000_000,
    meta: { err: null, logMessages: txLogs(s === SIG_A ? claimedLog(SESSION_A, OWNER_A) : claimedLog(SESSION_B, OWNER_B)) },
  }));
});

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const url = (q = "") => new Request(`http://x/api/sessions/${SESSION_A}/events${q}`);

describe("GET /api/sessions/[addr]/events attribution", () => {
  it("keeps events for the requested session and drops those naming another session", async () => {
    const res = await events.GET(url("?limit=2"), params({ addr: SESSION_A }));
    expect(res.status).toBe(200);
    const body = EventsResponse.parse(await res.json());
    expect(body.events.map((e) => [e.type, e.signature])).toEqual([["Claimed", SIG_A]]);
    expect(body.events[0].type === "Claimed" && body.events[0].data.owner).toBe(OWNER_A);
    expect(body.nextBefore).toBe(SIG_B); // paging is still driven by the signatures, not the kept events
  });
});
