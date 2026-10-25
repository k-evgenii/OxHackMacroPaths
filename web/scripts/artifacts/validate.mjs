// Nonmutating check of the published research bundle (web/public/data). Safe for CI and prebuild.
// Usage: node scripts/artifacts/validate.mjs [dir]
import { PUBLISHED, runCli, validatePublished } from "./fsbundle.mjs";

runCli(() => {
  const b = validatePublished(process.argv[2] ?? PUBLISHED);
  console.log(`research bundle ${b.id} valid (schema v${b.schemaVersion})`);
});
