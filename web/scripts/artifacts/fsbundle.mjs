// Filesystem helpers for the explicit research-artifact publication and validation commands.
import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BundleError, FILES, buildBundle, identityOf } from "../../src/server/research/core.mjs";

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PUBLISHED = path.join(WEB, "public", "data");
export const IDENTITY = "bundle-identity.json";

/** Source names accepted in a candidate directory (research output uses table.json for the forecast). */
const SOURCES = { manifest: ["manifest.json"], forecast: ["forecast.json", "table.json"], planner: ["planner.json"] };

export function readTexts(dir, sources = { manifest: ["manifest.json"], forecast: ["forecast.json"], planner: ["planner.json"] }) {
  if (!existsSync(dir)) throw new BundleError("missing_file", `directory ${dir} does not exist`);
  const texts = {};
  for (const f of FILES) {
    const hit = sources[f].map((n) => path.join(dir, n)).find((p) => existsSync(p));
    if (!hit) throw new BundleError("missing_file", `${dir} has no ${sources[f].join(" or ")}`);
    texts[f] = readFileSync(hit, "utf8");
  }
  return texts;
}

export const identityText = (bundle) => JSON.stringify(identityOf(bundle), null, 2) + "\n";

/** Nonmutating check of a published directory: bundle validates and the identity file matches its bytes. */
export function validatePublished(dir = PUBLISHED) {
  const bundle = buildBundle(readTexts(dir));
  const idPath = path.join(dir, IDENTITY);
  if (!existsSync(idPath)) throw new BundleError("identity_mismatch", `${idPath} is missing; publish the bundle`);
  const recorded = readFileSync(idPath, "utf8");
  if (recorded !== identityText(bundle))
    throw new BundleError("identity_mismatch", `${idPath} does not match the published files (expected id ${bundle.id})`);
  return bundle;
}

/**
 * Validate the whole candidate first, then replace the published files. Nothing is written if validation fails;
 * if a write fails midway the previous files are restored from backups.
 */
export function publish(fromDir, toDir = PUBLISHED) {
  const texts = readTexts(fromDir, SOURCES);
  const bundle = buildBundle(texts); // throws before any mutation
  const outputs = { ...Object.fromEntries(FILES.map((f) => [`${f}.json`, texts[f]])), [IDENTITY]: identityText(bundle) };
  const staged = [];
  const backups = [];
  try {
    for (const [name, text] of Object.entries(outputs)) {
      const tmp = path.join(toDir, `.${name}.candidate`);
      writeFileSync(tmp, text);
      staged.push([tmp, path.join(toDir, name)]);
    }
    for (const [, dst] of staged)
      if (existsSync(dst)) {
        copyFileSync(dst, `${dst}.bak`);
        backups.push(dst);
      }
    for (const [tmp, dst] of staged) renameSync(tmp, dst);
  } catch (e) {
    for (const dst of backups) renameSync(`${dst}.bak`, dst);
    for (const [tmp] of staged) if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
  for (const dst of backups) if (existsSync(`${dst}.bak`)) unlinkSync(`${dst}.bak`);
  return bundle;
}

export function runCli(fn) {
  try {
    fn();
  } catch (e) {
    console.error(e instanceof BundleError ? `artifact bundle error: ${e.message}` : e);
    process.exit(1);
  }
}
