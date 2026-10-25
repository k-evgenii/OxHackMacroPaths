// Refresh web/public/data/{manifest,forecast,planner}.json from the repo's forecast/ dir when it exists.
// Without it (fresh clone, CI) the committed copies are kept silently.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.resolve(web, "../forecast");
const dst = path.join(web, "public", "data");
const map = { "manifest.json": "manifest.json", "table.json": "forecast.json", "planner.json": "planner.json", "conditional.json": "conditional.json", "presentation.json": "presentation.json" };

if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  for (const [from, to] of Object.entries(map)) {
    const f = path.join(src, from);
    if (existsSync(f)) copyFileSync(f, path.join(dst, to));
  }
}
