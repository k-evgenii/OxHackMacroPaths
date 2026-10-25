import { PositionsResponse, toCoverView, toPositionView, type CoverView, type PositionView } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { getSessionView, listSessionChildren } from "@/server/chain"; // registered sessions only

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: Request, ctx: { params: Promise<{ addr: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await getSessionView((await ctx.params).addr);
    const positions: PositionView[] = [];
    const covers: CoverView[] = [];
    for (const a of await listSessionChildren(session)) {
      if (a.kind === "Position") positions.push(toPositionView(a.address, a.data, session));
      else if (a.kind === "Cover") covers.push(toCoverView(a.address, a.data, session));
    }
    return okJson(PositionsResponse, { positions, covers });
  });
}
