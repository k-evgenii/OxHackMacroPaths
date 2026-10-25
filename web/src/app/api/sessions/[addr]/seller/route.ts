import { PublicKey } from "@solana/web3.js";
import { SellerResponse, quotePda, sellerPda, toEntryQuoteView, toSellerView } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { getAccounts, getSessionView, ownAccount } from "@/server/chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: Request, ctx: { params: Promise<{ addr: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await getSessionView((await ctx.params).addr);
    const key = new PublicKey(session.address);
    const [sellerKey] = sellerPda(key);
    const [quoteKey] = quotePda(key);
    const [sellerInfo, quoteInfo] = await getAccounts(session, [sellerKey, quoteKey]);
    const s = ownAccount(sellerInfo, "Seller");
    const q = ownAccount(quoteInfo, "EntryQuote");
    return okJson(SellerResponse, {
      seller: s ? toSellerView(sellerKey.toBase58(), s) : null,
      quote: q ? toEntryQuoteView(quoteKey.toBase58(), q) : null,
    });
  });
}
