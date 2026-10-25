import { fixtureJson } from "@/server/fixtures";
// Raw typed session history for developer tooling. Client Market activity uses SessionView.path,
// not this transaction-heavy route.
import { EventsResponse } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { sessionRepository } from "@/server/sessions";
import { getSessionEventsPage, parseHistoryQuery, REQUEST_BUDGET_MS, transactionRepository } from "@/server/history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: Request, ctx: { params: Promise<{ addr: string }> }): Promise<Response> {
  return handle(async () => {
    const url = new URL(req.url);
    const fixture = await fixtureJson(url.pathname + url.search, EventsResponse);
    if (fixture) return fixture;
    const deadlineAt = Date.now() + REQUEST_BUDGET_MS;
    const request = parseHistoryQuery(new URL(req.url).searchParams);
    // Validates the address and that it is a MacroPaths session (400/404/502 as before).
    const session = await sessionRepository.get((await ctx.params).addr);
    const page = await getSessionEventsPage(transactionRepository, session.address, request, { signal: req.signal, deadlineAt });
    return okJson(EventsResponse, page);
  });
}
