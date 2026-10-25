// Shared query-string validation for history routes (events and wallet activity).
import { badRequest } from "@/server/errors";
import type { HistoryPageRequest } from "./types";

const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const CURSOR_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** before: signature; limit: decimal 1..25 (default 10); retryCursor alone. */
export function parseHistoryQuery(q: URLSearchParams): HistoryPageRequest {
  const before = q.get("before");
  const limit = q.get("limit");
  const retryCursor = q.get("retryCursor");
  if (retryCursor !== null) {
    if (before !== null || limit !== null) throw badRequest("retryCursor cannot be combined with before or limit");
    if (!CURSOR_RE.test(retryCursor)) throw badRequest("invalid retryCursor");
    return { retryCursor };
  }
  const out: HistoryPageRequest = {};
  if (before !== null) {
    if (!SIGNATURE_RE.test(before)) throw badRequest("invalid before: not a base58 transaction signature");
    out.before = before;
  }
  if (limit !== null) {
    if (!/^\d{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 25) throw badRequest("limit must be an integer in 1..25");
    out.limit = Number(limit);
  }
  return out;
}
