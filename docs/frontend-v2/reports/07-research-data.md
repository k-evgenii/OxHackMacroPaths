# Report — Agent 07 research-data

## Changed files (all owned)

- `web/src/server/research/core.mjs` + `core.d.mts` — shared validation/normalization/identity (plain ESM so node scripts and the Next server use one implementation).
- `web/src/server/research/index.ts` — `@/server/research`: `getResearchBundle()`, `getArtifactText(name)`, `PUBLISHED_IDENTITY`, `associateSession`, `BundleError`.
- `web/src/app/api/artifacts/[name]/route.ts` — legacy `manifest|forecast|planner` plus new `bundle`; `x-research-bundle-id` + `etag` headers on the bundle.
- `web/src/lib/artifacts.ts` — `PUBLISHED_BUNDLE_ID`; legacy query keys now include the bundle id.
- `web/scripts/copy-artifacts.mjs` — compatibility command, no-op without `--from`.
- `web/scripts/artifacts/{fsbundle,publish,validate}.mjs` — explicit publish / nonmutating validate.
- `web/public/data/bundle-identity.json`, `web/public/data/.gitattributes` (`*.json eol=lf`, hashes are byte-exact).
- `web/test/research/bundle.test.ts`.

## Bundle identity

`rb1-0b7cc96ef9810f17` (schema v1). Each file: SHA-256 of exact bytes. Id = `rb1-` + first 16 hex of
SHA-256(`manifest:<h>\nforecast:<h>\nplanner:<h>\n`). The identity file is not hashed. Same id in
`/data/bundle-identity.json`, `/api/artifacts/bundle` (`id`, header), and `PUBLISHED_BUNDLE_ID`.

## Commands

- Validate (nonmutating, CI/prebuild): `node scripts/artifacts/validate.mjs [dir]`
- Publish (explicit): `node scripts/artifacts/publish.mjs --from ../forecast` (accepts `table.json` or `forecast.json`)
- Compatibility: `node scripts/copy-artifacts.mjs [--from <dir>]`; without `--from` it changes nothing.

## Requests to Agent 15 (npm wiring, not done by me)

- Remove `predev`/`prebuild` copy (now harmless no-ops anyway); add `"prebuild": "node scripts/artifacts/validate.mjs"`,
  `"artifacts:validate"`, `"artifacts:publish": "node scripts/artifacts/publish.mjs"`.
- No outputFileTracing config needed: the bundle is statically imported by `@/server/research`.

## For Agent 10

`researchBundleQuery(bundleId)` key `['research', bundleId]`; use `PUBLISHED_BUNDLE_ID` from `@/lib/artifacts`
(or the catalog's `researchBundleId`) and check `body.id === bundleId`. Legacy query keys gained the id as a third element;
when Agent 10's `queries/research.ts` lands, `artifacts.ts` should re-export those (post-checkpoint task).

## Validation and normalization rules

- Products exactly cooling(index 0, executable), excess(1, executable), fuel(null, research only). Diesel, Floating-Loan,
  or Fuel marked executable → `unsupported_product`. Forecast quote products must equal the executable set.
- Caps agree across manifest products, `manifest.chain` (d_cap/a_cap/k), `forecast.caps`, `planner.caps`; thresholds
  (cooling null, excess k = planner excess, fuel k = planner fuel); `planner.prices*1e6` = quote millionths;
  `manifest_version` coherence; planner fuel showcase stat = manifest fuel stat (72833; a 72844 mix is rejected); cap_units.
- Terms: threshold/cap/quoteMillionths as decimal strings only from safe non-negative integers, otherwise `unsafe_integer`.
  Continuous research numbers (fits, prices, planner tables) are passed through unchanged.
- `generatedAt` is null (no source field). `associatedSession` is null; `associateSession` requires exact k/dCap/aCap,
  nObs, a dataset id in the manifest (absent → never) and `replayVerified`. Session A (80000/800000) is rejected.
- Error codes: missing_file (route 404), malformed_json, schema, inconsistent, unsupported_product, unsafe_integer,
  identity_mismatch (route 500).
- Publish validates the whole candidate before writing; stages `.candidate` files, backs up, renames, restores on failure.

## Embedded-mode note

Production serves statically imported JSON (no cwd dependency). In that mode id/hashes come from `bundle-identity.json`;
the validate command proves those hashes equal the file bytes. `ARTIFACTS_DIR` (tests) hashes the files directly.

## Not yet done / blockers

- Foundation checkpoint not merged: bundle response not yet passed through shared `ResearchBundle` zod (`okJson`);
  `artifacts.ts` still defines its own legacy schemas/queries. Swap both after the checkpoint.
- Test results: see final message.
