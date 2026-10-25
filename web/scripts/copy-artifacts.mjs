// Refresh web/public/data from research output only when asked: `node scripts/copy-artifacts.mjs --from ../forecast`.
// Without --from it does nothing, so dev, build and CI never overwrite the published, hash-pinned bundle
// (forecast/ in the repo holds newer research output than the bundle). --from runs the validated publication
// (scripts/artifacts/publish.mjs), which also rewrites bundle-identity.json.
import path from "node:path";

const i = process.argv.indexOf("--from");
if (i >= 0) {
  const { publish, runCli } = await import("./artifacts/fsbundle.mjs");
  runCli(() => console.log(`published research bundle ${publish(path.resolve(process.argv[i + 1])).id}`));
}
