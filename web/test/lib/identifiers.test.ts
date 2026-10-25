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

describe("identifiers have a single source", () => {
  it("no file under web/src spells the program id or the reference session as a literal", () => {
    expect(filesContaining(idl.address)).toEqual([]);
    expect(filesContaining(session.address)).toEqual([]);
  });

  it("the public devnet RPC endpoint is defined once, in server/rpc.ts", () => {
    expect(filesContaining("api.devnet.solana.com")).toEqual(["server/rpc.ts"]);
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
