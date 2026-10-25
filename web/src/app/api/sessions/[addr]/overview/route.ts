import { SessionOverviewResponse } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { getSessionOverview } from "@/server/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: Request, ctx: { params: Promise<{ addr: string }> }): Promise<Response> {
  return handle(async () => okJson(SessionOverviewResponse, await getSessionOverview((await ctx.params).addr)));
}
