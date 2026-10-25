// Research bundle service (`@/server/research`). The published bundle is imported statically, so the production
// server output carries it and never depends on the runtime working directory. ARTIFACTS_DIR (tests/local
// inspection only) switches to reading exact file bytes from that directory instead.
import { readFile } from "node:fs/promises";
import path from "node:path";
import manifestJson from "../../../public/data/manifest.json";
import forecastJson from "../../../public/data/forecast.json";
import plannerJson from "../../../public/data/planner.json";
import identityJson from "../../../public/data/bundle-identity.json";
import { BundleError, FILES, buildBundle, type ArtifactName, type BuiltBundle, type BundleIdentity } from "./core.mjs";

export { BundleError, associateSession, buildBundle, exactIntString } from "./core.mjs";
export type { ArtifactName, BuiltBundle, BundleIdentity, ResearchTerm } from "./core.mjs";

export const ARTIFACT_NAMES: readonly ArtifactName[] = FILES;

/** Identity of the published bundle (id + per-file SHA-256), for cache keys and static-data cross-checks. */
export const PUBLISHED_IDENTITY: BundleIdentity = identityJson as BundleIdentity;

const EMBEDDED: Record<ArtifactName, unknown> = { manifest: manifestJson, forecast: forecastJson, planner: plannerJson };

async function readDir(dir: string): Promise<Record<ArtifactName, string>> {
  const out = {} as Record<ArtifactName, string>;
  for (const f of FILES) {
    try {
      out[f] = await readFile(path.join(dir, `${f}.json`), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new BundleError("missing_file", `${f}.json is not published`);
      throw e;
    }
  }
  return out;
}

let embedded: BuiltBundle | undefined;

/**
 * The validated, normalized published research bundle.
 * Embedded mode validates the imported artifacts semantically and takes id/hashes from bundle-identity.json,
 * which `scripts/artifacts/validate.mjs` checks against the exact file bytes (and publish.mjs writes atomically).
 */
export async function getResearchBundle(): Promise<BuiltBundle> {
  const dir = process.env.ARTIFACTS_DIR;
  if (dir) return buildBundle(await readDir(dir));
  if (!embedded) {
    const b = buildBundle(Object.fromEntries(FILES.map((f) => [f, JSON.stringify(EMBEDDED[f])])));
    embedded = { ...b, id: PUBLISHED_IDENTITY.id, metadata: { ...b.metadata, hashes: PUBLISHED_IDENTITY.hashes } };
  }
  return embedded;
}

/** One raw artifact (legacy `/api/artifacts/{name}` shape): exact file text when ARTIFACTS_DIR is set. */
export async function getArtifactText(name: ArtifactName): Promise<string> {
  const dir = process.env.ARTIFACTS_DIR;
  if (!dir) return JSON.stringify(EMBEDDED[name]);
  try {
    return await readFile(path.join(dir, `${name}.json`), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new BundleError("missing_file", `${name}.json is not published`);
    throw e;
  }
}
