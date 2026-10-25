// Frozen repository ports from docs/frontend-v2/interfaces.md ("Internal repository ports").
// Re-exported from the shared foundation contracts (web/src/server/contracts.ts).
import type { RpcAdmission } from "../contracts";
export type { RpcAdmission, RpcContext, RpcReader, CreateRpcReader } from "../contracts";
export type RpcLease = Awaited<ReturnType<RpcAdmission["acquire"]>>;

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
