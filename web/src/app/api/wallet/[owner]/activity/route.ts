import { WalletActivityResponse } from "@macropaths/client";
import { badRequest, handle, okJson } from "@/server/errors";
import { parsePubkey, parseSignature } from "@/server/chain";
import { DEFAULT_LIMIT, MAX_LIMIT, getWalletActivity } from "@/server/wallet/activity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: Request, ctx: { params: Promise<{ owner: string }> }): Promise<Response> {
  return handle(async () => {
    const owner = parsePubkey((await ctx.params).owner, "wallet owner").toBase58();
    const q = new URL(req.url).searchParams;
    const retryCursor = q.get("retryCursor");
    if (retryCursor !== null) {
      if (q.has("before") || q.has("limit")) throw badRequest("retryCursor cannot be combined with before or limit");
      // Opaque token; the shared repository validates kind/scope/expiry and rejects with 400.
      if (retryCursor.length === 0 || retryCursor.length > 512) throw badRequest("invalid retryCursor");
      return okJson(WalletActivityResponse, await getWalletActivity(owner, { retryCursor }, { signal: req.signal }));
    }
    const before = q.get("before") ? parseSignature(q.get("before")!) : undefined;
    const rawLimit = q.get("limit");
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== null) {
      if (!/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_LIMIT)
        throw badRequest(`limit must be an integer in 1..${MAX_LIMIT}`);
      limit = Number(rawLimit);
    }
    return okJson(WalletActivityResponse, await getWalletActivity(owner, { before, limit }, { signal: req.signal }));
  });
}
