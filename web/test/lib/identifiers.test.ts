// The program id and the reference session must each have one source: the IDL (via @macropaths/client) and
// NEXT_PUBLIC_DEFAULT_SESSION with the fixture session as fallback. Nothing under web/src spells them out.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Health, PROGRAM_ID } from "@macropaths/client";
import idl from "@macropaths/client/idl.json";
import session from "@macropaths/client/fixtures/session-B89z.view.json";

const SRC = path.resolve(__dirname, "../../src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}
const filesContaining = (needle: string) =>
  walk(SRC).filter((f) => readFileSync(f, "utf8").includes(needle)).map((f) => path.relative(SRC, f).split(path.sep).join("/"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// Walking web/src on the slow /mnt/d mount can exceed the 5s default.
describe("identifiers have a single source", { timeout: 60_000 }, () => {
  it("no file under web/src spells the program id or the reference session as a literal", () => {
    expect(filesContaining(idl.address)).toEqual([]);
    expect(filesContaining(session.address)).toEqual([]);
  });

  it("no committed source hard-codes a public devnet RPC URL (RPC_URL is read lazily by server/transport/config.ts)", () => {
    // .env.example, docs and tests may mention it; nothing under web/src or web/config may.
    const CONFIG = path.resolve(__dirname, "../../config");
    const configHits = readdirSync(CONFIG).filter((n) => readFileSync(path.join(CONFIG, n), "utf8").includes("api.devnet.solana.com"));
    expect([...filesContaining("api.devnet.solana.com"), ...configHits]).toEqual([]);
  });

  it("fixture-mode /api/health reports the IDL program id", async () => {
    vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", "1");
    vi.resetModules();
    const { fetchJson } = await import("@/lib/api-client");
    const h = await fetchJson("/api/health", Health);
    expect(h.programId).toBe(idl.address);
    expect(h.programId).toBe(PROGRAM_ID.toBase58());
  });

  it("DEFAULT_SESSION follows NEXT_PUBLIC_DEFAULT_SESSION and falls back to the fixture session", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_SESSION", "");
    vi.resetModules();
    expect((await import("@/lib/api-client")).DEFAULT_SESSION).toBe(session.address);

    vi.stubEnv("NEXT_PUBLIC_DEFAULT_SESSION", "11111111111111111111111111111111");
    vi.resetModules();
    expect((await import("@/lib/api-client")).DEFAULT_SESSION).toBe("11111111111111111111111111111111");
  });
});
