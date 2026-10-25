# Coordinator prompt — launch the fifteen-worker frontend implementation

Implement the MacroPaths frontend plan in `docs/frontend-v2`. The user prioritizes speed over token cost and authorizes fifteen concurrent implementation workers. Keep this assignment to the documented frontend/read-API scope; wallet transaction execution, program upgrades, remote publishing and deployment are excluded.

Read README.md, frontend-protocol.md, product-and-content.md, api-and-architecture.md, interfaces.md, design-system.md, parallel-execution.md, launcher-contract.md, acceptance.md and launch-manifest.json under that directory. Read `.claude/skills/macropaths-delivery/SKILL.md` and route other skills selectively. Inspect root repository rules and the actual frontend code before changing it.

## Preparation

Verify `evgenii/frontend` against its intended current remote/local head. The inspected historical SHA was dfb4b97ea40287c7308698bd21f7111248f2538e; never reset newer work to it. Preserve dirty research worktrees. Create an isolated integration worktree following the repository environment conventions.

If the pack was authored on the macro-research branch, transfer only `docs/frontend-v2/` and the four new `.claude/skills/macropaths-*` directories. Do not merge unrelated research edits. Record ORIGINAL_FRONTEND_SHA before changes.

Create the short foundation described in interfaces.md: actual shared schemas, type-only repository contracts, exact helper signatures, approved primitive/chart props and wallet context, test-only response fixtures, shared dependency locks/exports and test harness. Shared interfaces must compile; no fake successful production endpoints. Record the required baseline checks and avoid predev/prebuild silently overwriting research artifacts. Commit the pack and foundation, record concrete SHAs, and freeze them.

## Parallel execution

Create fifteen independent worktrees from FOUNDATION_SHA using launch-manifest.json. Render concrete launch context and the matching prompt for each worker. Launch all fifteen immediately. Merge dependencies constrain integration readiness, not start time. Use the installed Claude interface; do not assume undocumented CLI flags. If your runtime cannot launch fifteen itself, emit the resolved launch records/prompt files for the user's external runner rather than running workers in a shared checkout.

Workers use approved fixtures/ports while upstream modules are being implemented. Maintain single ownership of shared schemas, hooks, global CSS, package barrels, providers and lockfiles. Handle interface amendments centrally with a published checkpoint and explicit consumer updates.

Worker 15 prepares integration/QA immediately and integrates completed dependency closures. Inspect handoff reports, commits and changed-path ownership. Return incomplete producer tasks to their owners. Use parallel reviews where they resolve real risks; do not spend agents repeating identical full builds.

## Completion

Require all acceptance cases, integrated client/web checks and actual browser evidence. Report service/tooling limitations honestly. Keep live-mode fixture fallbacks out of the final application. Produce final SHA, integrated handoffs, screenshots, environment-variable names and remaining limitations. No push, remote merge, deployment, token-moving action or paid-service provisioning is performed without separate user direction.
