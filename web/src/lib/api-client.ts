// Integrator-owned contract between pages and the API.
// Pages never call fetch directly: they call fetchJson(path, Schema) with a zod schema from @macropaths/client.
// With NEXT_PUBLIC_USE_FIXTURES=1 every /api path is answered from packages/client/fixtures, so pages can be
// built before the API exists. Artifacts (/api/artifacts/<name>) fall back to /data/<name>.json in that mode.
import type { z } from "zod";
import { ApiError, PROGRAM_ID } from "@macropaths/client";
import sessionFixture from "@macropaths/client/fixtures/session-B89z.view.json";
import positionsFixture from "@macropaths/client/fixtures/positions-B89z.view.json";
import eventsFixture from "@macropaths/client/fixtures/events-B89z.view.json";

export const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES === "1";
export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";
// The reference session (settled session A) is the fixture's address; NEXT_PUBLIC_DEFAULT_SESSION overrides it.
// `||`, not `??`: an empty NEXT_PUBLIC_DEFAULT_SESSION= line in .env.local must fall back, not point at "".
export const DEFAULT_SESSION = process.env.NEXT_PUBLIC_DEFAULT_SESSION || sessionFixture.address;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Solana Explorer link for an address or a transaction signature on the configured cluster. */
export function explorerUrl(kind: "address" | "tx", id: string): string {
  return `https://explorer.solana.com/${kind}/${id}?cluster=${CLUSTER}`;
}

function fixtureFor(path: string): unknown | undefined {
  const url = new URL(path, "http://fixture");
  const p = url.pathname;
  const s = sessionFixture as { address: string };
  if (p === "/api/health")
    return { cluster: CLUSTER, slot: 0, programId: PROGRAM_ID.toBase58(), executable: true };
  if (p === "/api/sessions") {
    const v = sessionFixture as Record<string, unknown>;
    const keys = ["address", "sessionId", "authority", "state", "nObs", "nextIndex", "scores", "sideTotals", "depositDeadline", "replayDeadline"];
    return { sessions: [Object.fromEntries(keys.map((k) => [k, v[k]]))] };
  }
  const m = p.match(/^\/api\/sessions\/([^/]+)(\/(positions|seller|events))?$/);
  if (m) {
    if (m[1] !== s.address) return { __status: 404, error: "fixture has only session A", code: "not_found" };
    if (!m[3]) return sessionFixture;
    if (m[3] === "positions") return positionsFixture;
    if (m[3] === "seller") return { seller: null, quote: null };
    if (m[3] === "events") return eventsFixture;
  }
  return undefined;
}

export async function fetchJson<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
  if (USE_FIXTURES) {
    const f = fixtureFor(path) as { __status?: number; error?: string; code?: string } | undefined;
    if (f?.__status) throw new ApiRequestError(f.error ?? "error", f.__status, f.code ?? "internal");
    if (f !== undefined) return schema.parse(f);
    const art = path.match(/^\/api\/artifacts\/(\w+)/);
    if (art) path = `/data/${art[1]}.json`;
  }
  const res = await fetch(path, { headers: { accept: "application/json" } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ApiError.safeParse(body);
    throw new ApiRequestError(e.success ? e.data.error : res.statusText, res.status, e.success ? e.data.code : "internal");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Name the first mismatching field instead of dumping the raw zod issue array into the page.
    const i = parsed.error.issues[0];
    const where = i.path.length ? `${i.path.join(".")}: ` : "";
    throw new ApiRequestError(`Unexpected data format from ${path} (${where}${i.message}).`, res.status, "internal");
  }
  return parsed.data;
}
