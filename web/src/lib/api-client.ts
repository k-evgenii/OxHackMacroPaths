// Worker 10-owned contract between pages and the API.
// Pages never call fetch directly: they call fetchJson(path, Schema) with a zod schema from @macropaths/client.
// Fixture mode is explicit only (NEXT_PUBLIC_USE_FIXTURES=1): every client endpoint is answered from
// packages/client/fixtures without RPC or Redis. A live request failure is never answered with fixture data.
import type { z } from "zod";
import { ApiError } from "@macropaths/client/types";

export const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES === "1";
export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";
/**
 * Legacy reference-session fallback for pages not yet migrated to the catalog (`useSelectedSession`).
 * New code uses the catalog's `defaultSession`. `||`, not `??`: an empty env line must fall back.
 */
export const DEFAULT_SESSION = process.env.NEXT_PUBLIC_DEFAULT_SESSION || "B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju";

/** Normalized API/query error. `status` 0 means the request never produced an HTTP response. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Solana Explorer link for an address or a transaction signature on the configured cluster. */
export function explorerUrl(kind: "address" | "tx", id: string): string {
  return `https://explorer.solana.com/${kind}/${id}?cluster=${CLUSTER}`;
}

export type FetchJsonOptions = { signal?: AbortSignal };

function validate<S extends z.ZodTypeAny>(path: string, schema: S, body: unknown, status: number): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Name the first mismatching field instead of dumping the raw zod issue array into the page.
    const i = parsed.error.issues[0];
    const where = i && i.path.length ? `${i.path.join(".")}: ` : "";
    throw new ApiRequestError(
      `Unexpected data format from ${path.split("?")[0]} (${where}${i?.message ?? "invalid"}).`,
      status,
      "internal",
    );
  }
  return parsed.data;
}

function errorFromBody(body: unknown, status: number, fallback: string): ApiRequestError {
  const e = ApiError.safeParse(body);
  return new ApiRequestError(e.success ? e.data.error : fallback || "Request failed", status, e.success ? e.data.code : "internal");
}

const NO_FIXTURE: unique symbol = Symbol("no-fixture");

async function fetchFixture<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S> | typeof NO_FIXTURE> {
  // Dynamic import keeps fixture JSON out of live-mode bundles.
  const { fixtureResponse } = await import("@/lib/queries/fixture-router");
  signal?.throwIfAborted();
  const r = fixtureResponse(path);
  if (!r) return NO_FIXTURE;
  if (r.status >= 400) throw errorFromBody(r.body, r.status, "Fixture error");
  return validate(path, schema, r.body, r.status);
}

/**
 * GET an application API path and validate the body with the shared schema.
 * Cancellation: `options.signal` is passed through to fetch (TanStack Query supplies it).
 */
export async function fetchJson<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options?: FetchJsonOptions,
): Promise<z.infer<S>> {
  const signal = options?.signal;
  if (USE_FIXTURES) {
    const f = await fetchFixture(path, schema, signal);
    if (f !== NO_FIXTURE) return f;
    // Legacy research artifacts are static files in fixture mode.
    const art = path.match(/^\/api\/artifacts\/(manifest|forecast|planner)\b/);
    if (art) path = `/data/${art[1]}.json`;
    else throw new ApiRequestError(`No fixture for ${path.split("?")[0]}`, 404, "not_found");
  }
  let res: Response;
  try {
    res = await fetch(path, { headers: { accept: "application/json" }, signal });
  } catch (err) {
    if (signal?.aborted || (err as { name?: string } | null)?.name === "AbortError") throw err;
    throw new ApiRequestError("The application API could not be reached.", 0, "network");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw errorFromBody(body, res.status, res.statusText);
  return validate(path, schema, body, res.status);
}

/** Safe, user-facing description of a query error (never a raw Error dump or provider URL). */
export function describeError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 0) return "The application API could not be reached. Check your connection and retry.";
    if (err.status === 404) return "This item was not found.";
    if (err.status === 400) return "The request was not accepted.";
    if (err.status === 502) return "Chain data is temporarily unavailable. Retry shortly.";
    if (err.message.startsWith("Unexpected data format")) return "The response had an unexpected format.";
  }
  return "Something went wrong while loading data.";
}
