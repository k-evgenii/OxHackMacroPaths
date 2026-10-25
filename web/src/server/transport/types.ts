// Frozen repository ports from docs/frontend-v2/interfaces.md ("Internal repository ports").
// Declared locally until the foundation contracts land; shapes must stay identical.
import type { Connection } from "@solana/web3.js";

export type RpcContext = { signal?: AbortSignal; deadlineAt?: number };
export type RpcLease = { release(): Promise<void> };
export interface RpcAdmission {
  acquire(method: string, context: RpcContext): Promise<RpcLease>;
  noteRateLimit(method: string, retryAfterMs: number): Promise<void>;
}
export interface RpcReader {
  read<T>(method: string, op: (connection: Connection) => Promise<T>, context?: RpcContext): Promise<T>;
}

/** Lightweight measurement emitted once per read (not a telemetry vendor). */
export type RpcMetric = {
  method: string;
  attempts: number;
  durationMs: number;
  outcome: "ok" | "error";
  throttled: number; // count of 429 responses seen
  timedOut: number; // count of per-attempt timeouts
  cooldownMs: number; // total Retry-After cooldown recorded
  failureKind?: string;
};
