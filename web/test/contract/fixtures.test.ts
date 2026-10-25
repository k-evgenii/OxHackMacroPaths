// Integrator-owned: the fixtures must always satisfy the frozen contract.
import { describe, expect, it } from "vitest";
import { EventsResponse, PositionsResponse, SessionView } from "@macropaths/client";
import session from "@macropaths/client/fixtures/session-B89z.view.json";
import positions from "@macropaths/client/fixtures/positions-B89z.view.json";
import events from "@macropaths/client/fixtures/events-B89z.view.json";

describe("contract fixtures (reference session A)", () => {
  it("session view parses and matches the settled reference", () => {
    const v = SessionView.parse(session);
    expect(v.state).toBe("Settled");
    expect(v.nextIndex).toBe(48);
    expect(v.path).toHaveLength(48);
    expect(v.scores).toEqual(["827387", "863980"]);
    expect(v.integrityOk).toBe(true);
    const last = v.path[47];
    expect([last.peak, last.decline, last.excess]).toEqual([v.stats.peak, v.stats.maxDecline, v.stats.excessAcc]);
  });
  it("positions and events parse", () => {
    expect(PositionsResponse.parse(positions).positions).toHaveLength(1);
    const e = EventsResponse.parse(events);
    expect(e.events.filter((x) => x.type === "Observed")).toHaveLength(48);
    expect(e.events.filter((x) => x.type === "Settled")).toHaveLength(1);
  });
});
