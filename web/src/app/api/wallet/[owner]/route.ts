import { fixtureJson } from "@/server/fixtures";
import { WalletOverviewResponse } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { getWalletOverview } from "@/server/wallet/overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public read of one wallet's PLAY balances and own holdings. GET only; no writes, no signatures. */
export function GET(_req: Request, ctx: { params: Promise<{ owner: string }> }): Promise<Response> {
  return handle(async () => {
    const value = (await ctx.params).owner;
    const fixture = await fixtureJson(`/api/wallet/${encodeURIComponent(value)}`, WalletOverviewResponse);
    return fixture ?? okJson(WalletOverviewResponse, await getWalletOverview(value));
  });
}
