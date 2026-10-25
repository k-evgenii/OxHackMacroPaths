import { SessionList, toSessionView, type SessionSummary } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { listSessionAccounts } from "@/server/chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SESSION_ALLOWLIST: comma-separated session addresses. When set, only those are listed, in that order. */
const allowlist = () =>
  (process.env.SESSION_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function GET(): Promise<Response> {
  return handle(async () => {
    const allow = allowlist();
    const sessions: SessionSummary[] = [];
    for (const a of await listSessionAccounts()) {
      if (allow.length > 0 && !allow.includes(a.address)) continue;
      try {
        const v = toSessionView(a.address, a.data);
        sessions.push(SessionList.shape.sessions.element.parse(v));
      } catch (e) {
        console.warn(`[api] skipping undecodable session ${a.address}`, e);
      }
    }
    if (allow.length > 0) sessions.sort((x, y) => allow.indexOf(x.address) - allow.indexOf(y.address));
    else sessions.sort((x, y) => y.replayDeadline - x.replayDeadline);
    return okJson(SessionList, { sessions });
  });
}
