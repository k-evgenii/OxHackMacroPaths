import type { z } from "zod";
import type { ApiError } from "@macropaths/client";
import { RpcFailure } from "./rpc";

type Code = ApiError["code"];
const STATUS: Record<Code, number> = { bad_request: 400, not_found: 404, rpc_error: 502, internal: 500 };

export class HttpError extends Error {
  constructor(readonly code: Code, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (msg: string) => new HttpError("bad_request", msg);
export const notFound = (msg: string) => new HttpError("not_found", msg);

/** Client-facing text for an RPC failure. Never echoes the raw RPC message, which can carry provider details. */
export function rpcMessage(e: RpcFailure): string {
  const m = e.message;
  if (/Endpoint URL must start|Invalid URL/i.test(m)) return "RPC_URL is not a valid http(s) URL. Check web/.env.local and restart the server.";
  if (/429|too many requests|rate limit/i.test(m))
    return "The Solana RPC endpoint is rate-limiting requests (HTTP 429). Wait a few seconds and retry, or set RPC_URL to a dedicated devnet endpoint.";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|timed? ?out/i.test(m))
    return "Could not reach the Solana RPC endpoint. Check RPC_URL and the network, then retry.";
  return "RPC request failed. Retry, and check that RPC_URL points at a working devnet endpoint.";
}

const NO_STORE = { "cache-control": "no-store" };

export function errorResponse(code: Code, error: string): Response {
  const body: ApiError = { error, code };
  return Response.json(body, { status: STATUS[code], headers: NO_STORE });
}

export function toErrorResponse(e: unknown): Response {
  if (e instanceof HttpError) return errorResponse(e.code, e.message);
  if (e instanceof RpcFailure) {
    console.error("[api] rpc_error", e.message);
    return errorResponse("rpc_error", rpcMessage(e));
  }
  console.error("[api] internal", e);
  return errorResponse("internal", "internal error");
}

/** Validate `body` against the contract schema, then send it; schema violations become 500 internal. */
export function okJson<S extends z.ZodTypeAny>(schema: S, body: z.input<S>): Response {
  const r = schema.safeParse(body);
  if (!r.success) {
    console.error("[api] response failed contract validation", r.error.issues.slice(0, 5));
    return errorResponse("internal", "response failed contract validation");
  }
  return Response.json(r.data, { headers: NO_STORE });
}

/** Wrap a handler body so every thrown error becomes an ApiError response. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return toErrorResponse(e);
  }
}
