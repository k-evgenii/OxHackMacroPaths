// Test doubles for the history repository: a fake admitted reader over a controllable fake chain.
import { PublicKey } from "@solana/web3.js";
import { IDL, PROGRAM_ID } from "@macropaths/client";
import type { RpcContext, RpcReader } from "@/server/history/types";

export const PID = PROGRAM_ID.toBase58();
export const SESSION_A = "B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju";
export const SESSION_B = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
export const OWNER = new PublicKey(new Uint8Array(32).fill(5)).toBase58();

/** Deterministic 87-char base58 signature. */
export const sig = (n: number) => (String(n).replace(/0/g, "z") + "x").padEnd(87, "1");

/** Borsh-encoded Claimed{session, owner, amounts:[a0,a1], refund} log, as the program emits it. */
export function claimedLog(session: string, owner: string, a0 = 1n, a1 = 2n): string {
  const disc = IDL.events!.find((e) => e.name === "Claimed")!.discriminator;
  const amounts = Buffer.alloc(16);
  amounts.writeBigUInt64LE(a0, 0);
  amounts.writeBigUInt64LE(a1, 8);
  const body = Buffer.concat([Buffer.from(disc), new PublicKey(session).toBuffer(), new PublicKey(owner).toBuffer(), amounts, Buffer.from([0])]);
  return `Program data: ${body.toString("base64")}`;
}
export const programLogs = (...eventLogs: string[]) => [`Program ${PID} invoke [1]`, "Program log: Instruction: Claim", ...eventLogs, `Program ${PID} success`];

export type TxBehavior = "ok" | "null" | "error" | "hang" | "failed";

export class FakeChain {
  /** Newest first. */
  signatures: { signature: string; confirmationStatus: "confirmed" | "finalized" }[] = [];
  logs = new Map<string, string[]>();
  behavior = new Map<string, TxBehavior>();
  sigListFails = false;
  calls = { getTransaction: [] as string[], getSignaturesForAddress: 0 };
  aborted: string[] = [];

  add(signature: string, logs: string[], confirmationStatus: "confirmed" | "finalized" = "finalized") {
    this.signatures.push({ signature, confirmationStatus });
    this.logs.set(signature, logs);
  }
  /** Simulate new signatures arriving at the head. */
  prepend(signature: string, logs: string[]) {
    this.signatures.unshift({ signature, confirmationStatus: "confirmed" });
    this.logs.set(signature, logs);
  }

  connection(ctx?: RpcContext) {
    return {
      getSignaturesForAddress: async (_k: PublicKey, o: { before?: string; limit?: number }) => {
        this.calls.getSignaturesForAddress++;
        if (this.sigListFails) throw new Error("429 Too Many Requests");
        const start = o.before ? this.signatures.findIndex((s) => s.signature === o.before) + 1 : 0;
        return this.signatures.slice(start, start + (o.limit ?? 1000)).map((s) => ({ ...s, slot: 1, blockTime: 1, err: null, memo: null }));
      },
      getTransaction: async (signature: string) => {
        this.calls.getTransaction.push(signature);
        const b = this.behavior.get(signature) ?? "ok";
        if (b === "error") throw new Error("429 Too Many Requests");
        if (b === "null") return null;
        if (b === "hang")
          return new Promise((_r, reject) =>
            ctx?.signal?.addEventListener("abort", () => (this.aborted.push(signature), reject(new Error("aborted"))), { once: true }),
          );
        return {
          slot: 100,
          blockTime: 1_700_000_000,
          transaction: {
            message: {
              staticAccountKeys: [new PublicKey(OWNER), PROGRAM_ID],
              compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0], data: new Uint8Array([1, 2, 3]) }],
            },
          },
          meta: {
            err: b === "failed" ? { InstructionError: [0, "Custom"] } : null,
            logMessages: this.logs.get(signature) ?? [],
            loadedAddresses: { writable: [], readonly: [] },
            innerInstructions: [],
            preTokenBalances: [],
            postTokenBalances: [],
          },
        };
      },
    };
  }

  reader(): RpcReader {
    return {
      read: async (_method, op, ctx) => op(this.connection(ctx) as never),
    };
  }
}
