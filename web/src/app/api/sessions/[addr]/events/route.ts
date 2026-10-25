import { EventsResponse } from "@macropaths/client";
import { badRequest, handle, okJson } from "@/server/errors";
import { getSessionEvents, getSessionView, parseSignature } from "@/server/chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: Request, ctx: { params: Promise<{ addr: string }> }): Promise<Response> {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const before = q.get("before") ? parseSignature(q.get("before")!) : undefined;
    const rawLimit = q.get("limit") ?? "50";
    const limit = Number(rawLimit);
    if (!/^\d{1,3}$/.test(rawLimit) || limit < 1 || limit > 100) throw badRequest("limit must be an integer in 1..100");
    const session = await getSessionView((await ctx.params).addr);
    return okJson(EventsResponse, await getSessionEvents(session, { before, limit }));
  });
}
