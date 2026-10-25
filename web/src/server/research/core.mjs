// Research bundle core: validation, exact normalization and identity of the published research artifacts.
// Plain ESM so the Next server (via core.d.mts types) and the node publication/validation scripts share one
// implementation. No filesystem access here; callers pass the exact file bytes.
//
// Identity: each file is hashed with SHA-256 over its exact UTF-8 bytes. The bundle id is
//   (LF-normalized, see contentHash) "rb1-" + first 16 hex chars of SHA-256("manifest:<h>\nforecast:<h>\nplanner:<h>\n").
// The identity file (bundle-identity.json) is never part of the hashed input.
import { createHash } from "node:crypto";
import { z } from "zod";

export const SCHEMA_VERSION = 1;
export const FILES = /** @type {const} */ (["manifest", "forecast", "planner"]);

/** Products this release recognizes, and what each is allowed to be. Anything else is unsupported. */
export const SUPPORTED = {
  cooling: { index: 0, executable: true, capUnits: "1e-4 pp", units: "1e-4-pp" },
  excess: { index: 1, executable: true, capUnits: "1e-4 pp-months", units: "1e-4-pp-months" },
  fuel: { index: null, executable: false, capUnits: "1e-4 usd-months", units: "1e-4-usd-months" },
};

export class BundleError extends Error {
  /** @param {"missing_file"|"malformed_json"|"schema"|"inconsistent"|"unsupported_product"|"unsafe_integer"|"identity_mismatch"} code */
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "BundleError";
    this.code = code;
  }
}

const num = z.number().finite();
const Product = z
  .object({
    index: z.number().int().nullable(),
    key: z.string(),
    cap: num,
    cap_units: z.string(),
    k: num.nullable(),
    executable: z.boolean(),
  })
  .passthrough();
const RawManifest = z
  .object({
    version: num,
    products: z.array(Product),
    chain: z.object({ k: num, d_cap: num, a_cap: num }).passthrough().optional(),
    showcase: z.object({ fuel: z.object({ stat: num }).passthrough() }).passthrough(),
    snapshots: z.record(z.object({ retrieved_at: z.string() }).passthrough()).optional(),
  })
  .passthrough();
const RawForecast = z
  .object({
    manifest_version: num.optional(),
    n_paths: num,
    caps: z.record(num).optional(),
    quotes: z
      .object({ p: z.array(num), products: z.array(z.string()), fuel_research_quote: num })
      .passthrough(),
  })
  .passthrough();
const RawPlanner = z
  .object({
    manifest_version: num.optional(),
    prices: z.object({ excess: num, fuel: num }).passthrough(),
    caps: z.object({ cooling: num, excess: num, fuel: num }).passthrough(),
    thresholds: z.object({ excess_k_1e4pp: num, fuel_k_1e4usd: num }).passthrough(),
    showcase: z.object({ fuel_stat_1e4usdmonths: num.optional() }).passthrough(),
  })
  .passthrough();

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** File hash: SHA-256 of the UTF-8 bytes with CRLF normalized to LF (the committed form, see public/data/.gitattributes),
 *  so a Windows checkout with core.autocrlf produces the same identity. */
export const contentHash = (text) => sha256(text.replace(/\r\n/g, "\n"));

/** @param {{manifest:string,forecast:string,planner:string}} hashes */
export function bundleIdOf(hashes) {
  const joined = FILES.map((f) => `${f}:${hashes[f]}\n`).join("");
  return `rb1-${sha256(joined).slice(0, 16)}`;
}

/** Exact decimal string for a scaled integer research quantity. Rejects anything not a safe non-negative integer. */
export function exactIntString(value, what) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new BundleError("unsafe_integer", `${what} = ${value} is not a safe non-negative integer`);
  return String(value);
}

function parseJson(name, text) {
  if (typeof text !== "string") throw new BundleError("missing_file", `${name}.json is missing`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new BundleError("malformed_json", `${name}.json: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function schema(name, s, value) {
  const r = s.safeParse(value);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new BundleError("schema", `${name}.json ${i.path.join(".")}: ${i.message}`);
  }
  return value; // keep the original object: every legacy field stays usable
}

const fail = (msg) => {
  throw new BundleError("inconsistent", msg);
};

/**
 * Validate the three artifact texts against each other and build the normalized research bundle.
 * @param {{manifest?:string,forecast?:string,planner?:string}} texts exact file contents
 * @param {{associatedSession?: string|null}} [opts] only a verified association (see associateSession) may be passed
 */
export function buildBundle(texts, opts = {}) {
  const manifest = schema("manifest", RawManifest, parseJson("manifest", texts.manifest));
  const forecast = schema("forecast", RawForecast, parseJson("forecast", texts.forecast));
  const planner = schema("planner", RawPlanner, parseJson("planner", texts.planner));

  // Products: exactly the recognized release set, with their allowed executability.
  const keys = manifest.products.map((p) => p.key);
  for (const p of manifest.products) {
    const s = SUPPORTED[p.key];
    if (!s) throw new BundleError("unsupported_product", `product "${p.key}" is not part of this release`);
    if (p.executable !== s.executable || p.index !== s.index)
      throw new BundleError(
        "unsupported_product",
        `product "${p.key}" claims index=${p.index} executable=${p.executable}; this release allows index=${s.index} executable=${s.executable}`,
      );
    if (p.cap_units !== s.capUnits) fail(`product "${p.key}" cap_units "${p.cap_units}" != "${s.capUnits}"`);
  }
  if (new Set(keys).size !== keys.length) fail("duplicate product keys in manifest");
  for (const k of Object.keys(SUPPORTED)) if (!keys.includes(k)) fail(`manifest is missing product "${k}"`);
  const prod = Object.fromEntries(manifest.products.map((p) => [p.key, p]));

  // Revision coherence.
  for (const [n, a] of [["forecast", forecast], ["planner", planner]])
    if (a.manifest_version !== undefined && a.manifest_version !== manifest.version)
      fail(`${n}.manifest_version ${a.manifest_version} != manifest.version ${manifest.version}`);

  // Caps agree everywhere they appear.
  for (const k of Object.keys(SUPPORTED)) {
    const cap = prod[k].cap;
    if (planner.caps[k] !== cap) fail(`planner cap ${k} ${planner.caps[k]} != manifest ${cap}`);
    if (forecast.caps && forecast.caps[k] !== undefined && forecast.caps[k] !== cap)
      fail(`forecast cap ${k} ${forecast.caps[k]} != manifest ${cap}`);
  }
  if (manifest.chain) {
    if (manifest.chain.d_cap !== prod.cooling.cap) fail(`manifest.chain.d_cap != cooling cap`);
    if (manifest.chain.a_cap !== prod.excess.cap) fail(`manifest.chain.a_cap != excess cap`);
    if (manifest.chain.k !== prod.excess.k) fail(`manifest.chain.k != excess k`);
  }

  // Thresholds.
  if (prod.cooling.k !== null) fail("cooling must have no threshold");
  if (planner.thresholds.excess_k_1e4pp !== prod.excess.k) fail(`planner excess threshold != manifest excess k`);
  if (planner.thresholds.fuel_k_1e4usd !== prod.fuel.k) fail(`planner fuel threshold != manifest fuel k`);

  // Quotes: forecast quotes cover exactly the executable products; planner prices are the same quotes.
  const q = forecast.quotes;
  if (q.p.length !== q.products.length) fail("forecast quotes p/products length mismatch");
  const execKeys = keys.filter((k) => prod[k].executable);
  if ([...q.products].sort().join() !== [...execKeys].sort().join())
    throw new BundleError("unsupported_product", `forecast quotes products [${q.products}] != executable products [${execKeys}]`);
  const quote = Object.fromEntries(q.products.map((k, i) => [k, q.p[i]]));
  quote.fuel = q.fuel_research_quote;
  for (const k of ["excess", "fuel"]) {
    const millionths = exactIntString(quote[k], `quote ${k}`);
    if (Math.abs(planner.prices[k] * 1e6 - Number(millionths)) > 1e-6)
      fail(`planner price ${k} ${planner.prices[k]} != forecast quote ${millionths} millionths`);
  }

  // Fuel showcase statistic must come from the same revision (72833 in the committed bundle).
  const ps = planner.showcase.fuel_stat_1e4usdmonths;
  if (ps !== undefined && ps !== manifest.showcase.fuel.stat)
    fail(`planner showcase fuel stat ${ps} != manifest showcase fuel stat ${manifest.showcase.fuel.stat}`);

  exactIntString(forecast.n_paths, "forecast.n_paths");

  const terms = Object.keys(SUPPORTED).map((k) => ({
    key: k,
    threshold: prod[k].k === null ? null : exactIntString(prod[k].k, `${k}.k`),
    cap: exactIntString(prod[k].cap, `${k}.cap`),
    units: SUPPORTED[k].units,
    quoteMillionths: exactIntString(quote[k], `quote ${k}`),
    researchOnly: !prod[k].executable,
  }));

  const hashes = { manifest: contentHash(texts.manifest), forecast: contentHash(texts.forecast), planner: contentHash(texts.planner) };
  return {
    id: bundleIdOf(hashes),
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      generatedAt: null, // the artifacts carry no generation timestamp; never fabricate one
      modelCurrency: "USD",
      moneyMeaning: "illustrative",
      hashes,
      associatedSession: opts.associatedSession ?? null,
    },
    terms,
    manifest,
    forecast,
    planner,
  };
}

/**
 * The only way to associate a bundle with a deployed session: exact terms equality, matching dataset/product
 * mapping and an explicitly verified replay. Returns the session address or null.
 * @param {{terms: Array<{key:string,threshold:string|null,cap:string}>, manifest: any}} bundle
 * @param {{address:string, k:string, dCap:string, aCap:string, nObs:number, datasetId:string|null, replayVerified:boolean}} session
 */
export function associateSession(bundle, session) {
  const t = Object.fromEntries(bundle.terms.map((x) => [x.key, x]));
  const chain = bundle.manifest.chain;
  if (!session.replayVerified || !chain || session.datasetId === null) return null;
  if (t.excess.threshold !== session.k || t.cooling.cap !== session.dCap || t.excess.cap !== session.aCap) return null;
  if (chain.n !== session.nObs) return null;
  if (chain.dataset_id === undefined || chain.dataset_id !== session.datasetId) return null; // no dataset id: no proof
  return session.address;
}

/** Identity record written next to the published files. */
export function identityOf(bundle) {
  return { id: bundle.id, schemaVersion: bundle.schemaVersion, hashes: bundle.metadata.hashes };
}
