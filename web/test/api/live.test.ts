// Opt-in: LIVE_DEVNET=1 npx vitest run test/api/live.test.ts
// Hits devnet through the real client functions (requires fe-01's implementations).
import { describe, expect, it } from "vitest";
import { EventsResponse, PositionsResponse, SellerResponse, SessionView } from "@macropaths/client";
import * as session from "@/app/api/sessions/[addr]/route";
import * as positions from "@/app/api/sessions/[addr]/positions/route";
import * as seller from "@/app/api/sessions/[addr]/seller/route";
import * as events from "@/app/api/sessions/[addr]/events/route";

const A = "B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju";
const ctx = { params: Promise.resolve({ addr: A }) };
const req = new Request(`http://x/api/sessions/${A}/events?limit=100`);

describe.skipIf(process.env.LIVE_DEVNET !== "1")("live devnet: session A", () => {
  it("session, positions, seller and events", async () => {
    const v = SessionView.parse(await (await session.GET(req, ctx)).json());
    expect(v.state).toBe("Settled");
    expect(v.nextIndex).toBe(48);
    expect(v.scores).toEqual(["827387", "863980"]);
    const p = PositionsResponse.parse(await (await positions.GET(req, ctx)).json());
    expect(p.positions).toHaveLength(1);
    expect(SellerResponse.parse(await (await seller.GET(req, ctx)).json())).toEqual({ seller: null, quote: null });
    const e = EventsResponse.parse(await (await events.GET(req, ctx)).json());
    expect(e.events.filter((x) => x.type === "Observed")).toHaveLength(48);
    expect(e.events.filter((x) => x.type === "Settled")).toHaveLength(1);
  }, 120_000);
});
