// Opt-in: LIVE_OVERVIEW=1 RPC_URL=https://api.devnet.solana.com npx vitest run test/api/live-overview.test.ts
import { describe, expect, it } from "vitest";
import { SessionOverviewResponse } from "@macropaths/client";
import registry from "../../config/sessions.json";
import * as overview from "@/app/api/sessions/[addr]/overview/route";

describe.skipIf(process.env.LIVE_OVERVIEW !== "1")("live devnet reference overview", () => {
  it("validates the registered session, caps and exact settled scores", async () => {
    expect(process.env.NEXT_PUBLIC_USE_FIXTURES).not.toBe("1");
    const addr = registry.defaultSession;
    const response = await overview.GET(new Request(`http://localhost/api/sessions/${addr}/overview`), { params: Promise.resolve({ addr }) });
    expect(response.status).toBe(200);
    const body = SessionOverviewResponse.parse(await response.json());
    expect(body.session.state).toBe("Settled");
    expect(body.session.terms.dCap).toBe(registry.sessions[0].terms.dCap);
    expect(body.session.terms.aCap).toBe(registry.sessions[0].terms.aCap);
    expect(body.session.scores).toEqual(["827387", "863980"]);
  }, 30_000);
});
