import { SessionList } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { getRegistry, sessionRepository } from "@/server/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Registered sessions only (web/config/sessions.json), in registry order. A failing entry fails the request. */
export function GET(): Promise<Response> {
  return handle(async () => {
    getRegistry();
    const views = await sessionRepository.listRegistered();
    return okJson(SessionList, { sessions: views.map((v) => SessionList.shape.sessions.element.parse(v)) });
  });
}
