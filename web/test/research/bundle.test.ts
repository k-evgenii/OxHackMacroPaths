// Research bundle: validation, exact normalization, identity, publication safety and production-style delivery.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BundleError,
  associateSession,
  buildBundle,
  bundleIdOf,
  exactIntString,
  sha256,
  contentHash,
} from "@/server/research/core.mjs";
import { publish, validatePublished } from "../../scripts/artifacts/fsbundle.mjs";
import { getResearchBundle, PUBLISHED_IDENTITY } from "@/server/research";
import * as route from "@/app/api/artifacts/[name]/route";
import { PUBLISHED_BUNDLE_ID } from "@/lib/artifacts";
import { ResearchBundle } from "@macropaths/client";

const WEB = path.resolve(__dirname, "../..");
const DATA = path.join(WEB, "public", "data");
const read = (n: string) => readFileSync(path.join(DATA, `${n}.json`), "utf8");
const texts = () => ({ manifest: read("manifest"), forecast: read("forecast"), planner: read("planner") });
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mutate = (name: "manifest" | "forecast" | "planner", fn: (o: J) => void) => {
  const t = texts();
  const o = JSON.parse(t[name]);
  fn(o);
  return { ...t, [name]: JSON.stringify(o) };
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BundleError);
    return (e as BundleError).code;
  }
  throw new Error("expected a BundleError");
};

describe("committed default bundle", () => {
  const b = buildBundle(texts());
  it("validates and normalizes terms to exact decimal strings", () => {
    expect(b.schemaVersion).toBe(1);
    expect(b.terms).toEqual([
      { key: "cooling", threshold: null, cap: "76973", units: "1e-4-pp", quoteMillionths: "384852", researchOnly: false },
      { key: "excess", threshold: "40000", cap: "1883141", units: "1e-4-pp-months", quoteMillionths: "57153", researchOnly: false },
      { key: "fuel", threshold: "35000", cap: "36411", units: "1e-4-usd-months", quoteMillionths: "108466", researchOnly: true },
    ]);
  });
  it("satisfies the shared ResearchBundle contract", () => {
    expect(ResearchBundle.safeParse(b).success).toBe(true);
  });
  it("does not fabricate metadata and carries no session association", () => {
    expect(b.metadata.generatedAt).toBeNull();
    expect(b.metadata.associatedSession).toBeNull();
    expect(b.metadata.modelCurrency).toBe("USD");
    expect(b.metadata.moneyMeaning).toBe("illustrative");
  });
  it("keeps legacy fields and continuous research numbers untouched", () => {
    expect(b.planner).toEqual(JSON.parse(read("planner")));
    expect(b.forecast).toEqual(JSON.parse(read("forecast")));
    expect((b.manifest as J).showcase.fuel.stat).toBe(72833); // the selected revision, not newer prose
  });
  it("hashes exact bytes with SHA-256 and matches the published identity", () => {
    expect(b.metadata.hashes.planner).toBe(contentHash(read("planner")));
    expect(b.metadata.hashes.planner).toBe(sha256(read("planner").split("\r\n").join("\n"))); // LF-normalized bytes
    expect(b.id).toBe(bundleIdOf(b.metadata.hashes));
    expect(b.id).toMatch(/^rb1-[0-9a-f]{16}$/);
    expect(PUBLISHED_IDENTITY.id).toBe(b.id);
    expect(PUBLISHED_BUNDLE_ID).toBe(b.id);
    expect(validatePublished(DATA).id).toBe(b.id);
  });
});

describe("identity", () => {
  it("a CRLF checkout yields the same identity as the committed LF bytes", () => {
    const crlf = Object.fromEntries(Object.entries(texts()).map(([k, v]) => [k, v.split("\r\n").join("\n").split("\n").join("\r\n")]));
    expect(buildBundle(crlf).id).toBe(buildBundle(texts()).id);
  });
  it("is deterministic and changes with contents", () => {
    expect(buildBundle(texts()).id).toBe(buildBundle(texts()).id);
    const changed = { ...texts(), forecast: read("forecast") + "\n" };
    expect(buildBundle(changed).id).not.toBe(buildBundle(texts()).id);
  });
});

describe("consistency failures", () => {
  it.each([
    ["planner cap", mutate("planner", (o) => (o.caps.excess = 80000))],
    ["forecast cap", mutate("forecast", (o) => (o.caps.cooling = 1))],
    ["chain cap", mutate("manifest", (o) => (o.chain.a_cap = 800000))],
    ["planner price", mutate("planner", (o) => (o.prices.excess = 0.06))],
    ["fuel threshold", mutate("planner", (o) => (o.thresholds.fuel_k_1e4usd = 1))],
    ["revision", mutate("planner", (o) => (o.manifest_version = 2))],
    ["mixed fuel revision", mutate("planner", (o) => (o.showcase.fuel_stat_1e4usdmonths = 72844))],
    ["units", mutate("manifest", (o) => (o.products[2].cap_units = "1e-4 pp"))],
  ])("%s mismatch is rejected", (_n, t) => expect(code(() => buildBundle(t))).toBe("inconsistent"));

  it("unsupported products and promoted research products are rejected", () => {
    const diesel = mutate("manifest", (o) => o.products.push({ ...o.products[2], key: "diesel" }));
    expect(code(() => buildBundle(diesel))).toBe("unsupported_product");
    const fuelExec = mutate("manifest", (o) => Object.assign(o.products[2], { executable: true, index: 2 }));
    expect(code(() => buildBundle(fuelExec))).toBe("unsupported_product");
    const quoted = mutate("forecast", (o) => {
      o.quotes.products.push("fuel");
      o.quotes.p.push(108466);
    });
    expect(code(() => buildBundle(quoted))).toBe("unsupported_product");
  });

  it("malformed JSON, missing files and schema violations are typed", () => {
    expect(code(() => buildBundle({ ...texts(), planner: "{broken" }))).toBe("malformed_json");
    expect(code(() => buildBundle({ manifest: read("manifest"), forecast: read("forecast") }))).toBe("missing_file");
    expect(code(() => buildBundle(mutate("forecast", (o) => delete o.quotes)))).toBe("schema");
  });
});

describe("exact integer normalization", () => {
  it("keeps safe integers exact and rejects unsafe or fractional values", () => {
    expect(exactIntString(9007199254740991, "x")).toBe("9007199254740991");
    expect(code(() => exactIntString(9007199254740992, "x"))).toBe("unsafe_integer");
    expect(code(() => exactIntString(1.5, "x"))).toBe("unsafe_integer");
    expect(code(() => exactIntString(-1, "x"))).toBe("unsafe_integer");
    const big = mutate("forecast", (o) => (o.quotes.fuel_research_quote = 2 ** 60));
    expect(code(() => buildBundle(big))).toBe("unsafe_integer");
  });
});

describe("session association", () => {
  const b = buildBundle(texts());
  it("reference session A (test caps 80000/800000) never receives the p90 bundle", () => {
    const a = { address: "A", k: "40000", dCap: "80000", aCap: "800000", nObs: 48, datasetId: "ds-a", replayVerified: true };
    expect(associateSession(b, a)).toBeNull();
  });
  it("even matching caps without dataset proof or replay verification do not associate", () => {
    const s = { address: "S", k: "40000", dCap: "76973", aCap: "1883141", nObs: 48, datasetId: "x", replayVerified: true };
    expect(associateSession(b, s)).toBeNull(); // manifest records no dataset id
    expect(associateSession(b, { ...s, replayVerified: false })).toBeNull();
  });
});

describe("publication", () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const setup = () => {
    dir = mkdtempSync(path.join(tmpdir(), "mp-bundle-"));
    const pub = path.join(dir, "pub");
    const cand = path.join(dir, "cand");
    cpSync(DATA, pub, { recursive: true });
    cpSync(DATA, cand, { recursive: true });
    return { pub, cand };
  };
  const snapshot = (d: string) => Object.fromEntries(readdirSync(d).map((f) => [f, readFileSync(path.join(d, f), "utf8")]));

  it("a failing candidate leaves the published bundle untouched", () => {
    const { pub, cand } = setup();
    const before = snapshot(pub);
    const p = JSON.parse(read("planner"));
    p.caps.fuel = 1;
    writeFileSync(path.join(cand, "planner.json"), JSON.stringify(p));
    expect(() => publish(cand, pub)).toThrow(BundleError);
    expect(snapshot(pub)).toEqual(before);
  });
  it("a missing candidate file fails before mutation", () => {
    const { pub, cand } = setup();
    const before = snapshot(pub);
    rmSync(path.join(cand, "forecast.json"));
    expect(() => publish(cand, pub)).toThrow(/missing_file/);
    expect(snapshot(pub)).toEqual(before);
  });
  it("a valid candidate (research layout: table.json) publishes files and a matching identity", () => {
    const { pub, cand } = setup();
    cpSync(path.join(cand, "forecast.json"), path.join(cand, "table.json"));
    rmSync(path.join(cand, "forecast.json"));
    writeFileSync(path.join(cand, "planner.json"), read("planner") + "\n");
    const b = publish(cand, pub);
    expect(validatePublished(pub).id).toBe(b.id);
    expect(b.id).not.toBe(PUBLISHED_IDENTITY.id);
    expect(readdirSync(pub).some((f) => f.endsWith(".bak") || f.endsWith(".candidate"))).toBe(false);
  });
  it("validation detects a stale identity file", () => {
    const { pub } = setup();
    writeFileSync(path.join(pub, "manifest.json"), read("manifest") + " ");
    expect(() => validatePublished(pub)).toThrow(/identity_mismatch/);
  });
});

describe("ordinary dev/build commands do not mutate published artifacts", () => {
  it("copy-artifacts without --from and validate.mjs leave public/data unchanged", () => {
    const stamp = () => readdirSync(DATA).map((f) => [f, statSync(path.join(DATA, f)).mtimeMs, sha256(readFileSync(path.join(DATA, f), "utf8"))]);
    const before = stamp();
    execFileSync(process.execPath, [path.join(WEB, "scripts/copy-artifacts.mjs")], { cwd: WEB });
    execFileSync(process.execPath, [path.join(WEB, "scripts/artifacts/validate.mjs")], { cwd: WEB });
    expect(stamp()).toEqual(before);
    expect(existsSync(path.join(DATA, "bundle-identity.json"))).toBe(true);
  });
});

describe("delivery", () => {
  const ctx = (name: string) => ({ params: Promise.resolve({ name }) });
  const req = () => new Request("http://x/api/artifacts");
  afterEach(() => {
    delete process.env.ARTIFACTS_DIR;
  });

  it("serves the embedded bundle without reading a source directory, from any cwd", async () => {
    delete process.env.ARTIFACTS_DIR;
    const cwd = process.cwd();
    const elsewhere = mkdtempSync(path.join(tmpdir(), "mp-cwd-"));
    process.chdir(elsewhere);
    try {
      const res = await route.GET(req(), ctx("bundle"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(PUBLISHED_IDENTITY.id);
      expect(res.headers.get("x-research-bundle-id")).toBe(body.id);
      expect(body.metadata.hashes).toEqual(PUBLISHED_IDENTITY.hashes);
      expect(body.terms[2]).toMatchObject({ key: "fuel", researchOnly: true });
      const legacy = await route.GET(req(), ctx("planner"));
      expect(await legacy.json()).toEqual(JSON.parse(read("planner")));
    } finally {
      process.chdir(cwd);
      rmSync(elsewhere, { recursive: true, force: true });
    }
    expect((await getResearchBundle()).id).toBe(PUBLISHED_IDENTITY.id);
  });

  it("an inconsistent directory bundle is a 500, a missing file a 404", async () => {
    const d = mkdtempSync(path.join(tmpdir(), "mp-dir-"));
    const t = mutate("planner", (o) => (o.caps.cooling = 80000));
    for (const [n, v] of Object.entries(t)) writeFileSync(path.join(d, `${n}.json`), v);
    process.env.ARTIFACTS_DIR = d;
    expect((await route.GET(req(), ctx("bundle"))).status).toBe(500);
    rmSync(path.join(d, "forecast.json"));
    expect((await route.GET(req(), ctx("bundle"))).status).toBe(404);
    rmSync(d, { recursive: true, force: true });
  });
});
