import { PublicKey } from "@solana/web3.js";
import { SellerResponse, quotePda, sellerPda, toEntryQuoteView, toSellerView } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { ownAccount, sessionRepository } from "@/server/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Raw seller/quote (developer compatibility). Missing account => null; RPC failure => rpc_error. */
export function GET(_req: Request, ctx: { params: Promise<{ addr: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await sessionRepository.get((await ctx.params).addr);
    const key = new PublicKey(session.address);
    const [sellerKey] = sellerPda(key);
    const [quoteKey] = quotePda(key);
    const [sellerInfo, quoteInfo] = await sessionRepository.getManyAccounts([sellerKey, quoteKey]);
    const s = ownAccount(sellerInfo, "Seller");
    const q = ownAccount(quoteInfo, "EntryQuote");
    return okJson(SellerResponse, {
      seller: s ? toSellerView(sellerKey.toBase58(), s) : null,
      quote: q ? toEntryQuoteView(quoteKey.toBase58(), q) : null,
    });
  });
}
