import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogResponse, ResearchBundle, SessionOverviewResponse, WalletOverviewResponse } from "@macropaths/client";
import { FIXTURE_OWNER } from "@/lib/queries/fixture-router";
import registry from "../../config/sessions.json";
import * as catalog from "@/app/api/catalog/route";
import * as research from "@/app/api/artifacts/[name]/route";
import * as overview from "@/app/api/sessions/[addr]/overview/route";
import * as wallet from "@/app/api/wallet/[owner]/route";

afterEach(() => vi.unstubAllEnvs());
const req = (path: string) => new Request(`http://localhost${path}`);
const context = <T,>(params: T) => ({ params: Promise.resolve(params) });

describe("fixture HTTP integration", () => {
  it("serves catalog and the exact published bundle independently of chain RPC", async () => {
    vi.stubEnv("RPC_URL", "");
    const c = CatalogResponse.parse(await (await catalog.GET()).json());
    const response = await research.GET(req("/api/artifacts/bundle"), context({ name: "bundle" }));
    expect(response.status).toBe(200);
    const b = ResearchBundle.parse(await response.json());
    expect(c.research?.bundleId).toBe(b.id);
    expect(c.sessions[0].presentation.researchBundleId).toBeNull();
  });
  it("serves reference overview and sample wallet without RPC in explicit fixture mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", "1");
    vi.stubEnv("RPC_URL", "");
    const response = await overview.GET(req(`/api/sessions/${registry.defaultSession}/overview`), context({ addr: registry.defaultSession }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-data-mode")).toBe("fixture");
    const s = SessionOverviewResponse.parse(await response.json());
    expect(s.session.scores).toEqual(["827387", "863980"]);
    const w = await wallet.GET(req(`/api/wallet/${FIXTURE_OWNER}`), context({ owner: FIXTURE_OWNER }));
    expect(w.status).toBe(200);
    expect(WalletOverviewResponse.parse(await w.json()).owner).toBe(FIXTURE_OWNER);
  });
  it("does not attach sample ownership to an unrelated wallet", async () => {
    vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", "1");
    const owner = "11111111111111111111111111111111";
    const response = await wallet.GET(req(`/api/wallet/${owner}`), context({ owner }));
    const w = WalletOverviewResponse.parse(await response.json());
    expect(w.owner).toBe(owner);
    expect(w.holdings.every((h) => h.read.status === "ok" && h.read.data.position === null && h.read.data.cover === null)).toBe(true);
  });
});
