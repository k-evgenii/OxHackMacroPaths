// Explicit publication of a research bundle into web/public/data.
// Usage: node scripts/artifacts/publish.mjs --from <dir>   (e.g. --from ../forecast)
// The candidate (manifest.json, table.json|forecast.json, planner.json) is fully validated before any file is
// replaced; a failing candidate leaves the existing published bundle untouched.
import path from "node:path";
import { publish, runCli } from "./fsbundle.mjs";

runCli(() => {
  const i = process.argv.indexOf("--from");
  const from = i >= 0 ? process.argv[i + 1] : undefined;
  if (!from) {
    console.error("usage: node scripts/artifacts/publish.mjs --from <dir>");
    process.exit(2);
  }
  const b = publish(path.resolve(from));
  console.log(`published research bundle ${b.id}`);
});
