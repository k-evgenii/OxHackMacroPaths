# Fifteen-worker parallel execution

## Start dependencies versus merge dependencies

All fifteen workers start from one completed foundation SHA. No worker waits idle for an upstream implementation: APIs use frozen ports; consumers use committed fixture contracts and test-only mocks. This requires a short coordinator bootstrap before launching the workers. Fifteen independent branches cannot safely invent shared APIs simultaneously.

The foundation contains actual schemas, type-only interfaces, fixture scenarios, common dependencies and a test harness. It must not contain fake successful live routes. Worker 01 hardens and tests the shared contract, rather than designing an incompatible one after consumers begin.

## Coordinator bootstrap

1. Verify frontend branch/head and clean/new isolated integration worktree. Preserve original dirty worktrees.
2. Copy this pack and only the four new skill folders to that frontend worktree. Read the existing repo rules and [frontend protocol](frontend-protocol.md).
3. Inspect baseline code against these contracts. Publish any necessary corrections to the documents before worker launch, rather than letting workers discover incompatible plans.
4. Pin common dependencies and package exports. Capture legacy source at original frontend SHA for developer-console migration.
5. Complete the [interface foundation checklist](interfaces.md#bootstrap-completion-checklist), fixtures, baseline checks, and a foundation commit.
6. Record ORIGINAL_FRONTEND_SHA, PACK_SHA, FOUNDATION_SHA, integration branch/worktree, and worker worktrees in the runner's state file. Runtime values are not guessed or hardcoded from this document.
7. Create fifteen branches/worktrees from FOUNDATION_SHA, render each prompt's launch context, and run all workers concurrently.

The coordinator performs orchestration; it is not an additional competing application-code worker. Worker 15 acts as the merge/integration owner after its independent preparation work. Serializing dependency installation/lockfile generation once saves avoidable conflicts; it does not serialize the feature work.

## Ownership

The [manifest](launch-manifest.json) is authoritative for active-worker write scope. Paths ending `/` own descendants; other paths are exact literal paths. Brackets in Next route paths are literal characters, not glob syntax. Exclusions subtract subtrees. Every worker can read shared source. Each owns only its own report file.

Important seams:

- 01: all shared client source, decoder, exact math and contract fixtures.
- 02: RPC transport; 03: Redis, transaction normalization, pagination and raw session event route. RPC consumes an injected admission port, avoiding transport/cache import cycles.
- 04: chain.ts account functions and session API. 03 moves transaction history to its new directory; it does not edit chain.ts.
- 05: wallet holdings; 06: wallet action history. They share contracts/repositories, not each other's implementation files.
- 07: artifact publication and schemas consumption. It owns lib/artifacts.ts only as a type/compatibility seam; actual shared query implementations are 10's domain.
- 08: kit tokens, global kit CSS and primitives. 09: chart modules with local styles. Neither edits the UI barrel concurrently with 15.
- 10: fetchJson, hooks, query keys/polling, wallet connection and shell. 11–14 consume these and own feature CSS modules/adapters.
- 15: root imports/providers, manifests/lockfiles, config, developer routes, redirects and browser harness. It does not refactor another active worker's module.

## Integration DAG

These are **merge-readiness dependencies**, not launch dependencies:

```text
foundation -> all workers start
01 -> 02 -> 03 -> 06
01 -> 04 -> 05 -> 06
01 -> 07
01 -> 08 -> 09
01 + 07 + 08 -> 10
04 + 05 + 08 + 09 + 10 -> 11 + 12
03 + 04 + 06 + 08 + 10 -> 13
04 + 07 + 08 + 09 + 10 -> 14
all implementation workers -> 15 final integration
```

Default merge order is 01,02,03,04,05,06,07,08,09,10,11,12,13,14,15. Ready independent branches may be integrated earlier while preserving the DAG. Use candidate integration branches/checkpoints to test a full dependency closure. Don't present a deliberately incomplete cherry-pick intermediate as a green full build.

## Work and handoff loop

Workers implement in their worktree, run meaningful scoped tests, inspect their diff, commit only owned files, and write their unique report. They may keep working on their own tests while a producer finishes. A blocked upstream import is reported with the expected interface, not fixed by inventing a replacement in another owner's files.

The coordinator collects dependency/interface requests in worker reports. Worker 15 applies approved package/config changes. For an interface change, publish one new checkpoint and update affected workers explicitly; do not require arbitrary sibling merges. If a worker's original assumptions become invalid, send that worker the checkpoint and a focused task to adapt.

After a worker hands off, the integrator may request amendments on that same branch. Once it is explicitly joined/closed, worker 15 may perform necessary cross-feature cleanup, recorded in its integration report. It never races an active owner.

## Legacy route migration

Worker 15 reads original page source from ORIGINAL_FRONTEND_SHA and creates `/dev` copies in new paths. It does not move directories out from under workers modifying public pages. After public features land, it redirects old client subroutes, removes superseded fallbacks, and updates imports.

`DEV_CONSOLE=1` is checked on the server; disabled routes return 404. Historical program agent deployment permissions do not apply to frontend worker 15.

## Reports and exits

Reports use [report-template](report-template.md). Success is a real commit plus evidence. Exit code alone is not proof of correctness; a worker that cannot finish writes an incomplete report with its exact blocker. Do not create a perpetual restart loop. One automatic retry is allowed for a clearly transient runner/process failure, using the same branch and logs; semantic failures go to the coordinator for diagnosis.

## Validation budget

Spend on useful parallel implementation, independent review, browser states and exact accounting checks. Do not have fifteen agents repeatedly install dependencies, rebuild Rust, edit locks or run identical full Next builds. Full integration checks belong to 15; workers run appropriate focused tests and report baseline-dependent checks honestly.
