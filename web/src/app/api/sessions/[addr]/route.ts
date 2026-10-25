import { SessionView } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { getSessionView } from "@/server/chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: Request, ctx: { params: Promise<{ addr: string }> }): Promise<Response> {
  return handle(async () => okJson(SessionView, await getSessionView((await ctx.params).addr)));
}
