import { SessionList, toSessionView, type SessionSummary } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { listSessionAccounts } from "@/server/chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(async () => {
    const sessions: SessionSummary[] = [];
    for (const a of await listSessionAccounts()) {
      try {
        const v = toSessionView(a.address, a.data);
        sessions.push(SessionList.shape.sessions.element.parse(v));
      } catch (e) {
        console.warn(`[api] skipping undecodable session ${a.address}`, e);
      }
    }
    sessions.sort((x, y) => y.replayDeadline - x.replayDeadline);
    return okJson(SessionList, { sessions });
  });
}
