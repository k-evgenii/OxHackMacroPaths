import { SessionView } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { sessionRepository } from "@/server/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: Request, ctx: { params: Promise<{ addr: string }> }): Promise<Response> {
  return handle(async () => okJson(SessionView, await sessionRepository.get((await ctx.params).addr)));
}
