# Scope of the frontend assignment

This is a frontend implementation assignment authorized by the user. It supplies a new ownership map for the read API and UI work. It does not assign any Rust-program or deployment responsibilities.

The existing frontend branch's root `AGENTS.md` describes an older program-agent team: `cursor_main` branches, numbered Rust assignments, per-worker Anchor builds, and specific deployment agents. Read it for product, arithmetic, environment, and security constraints. Do not interpret frontend worker IDs 01–15 as those old assignments. In particular, frontend worker 15 has **no deployment authorization**.

The coordinating user prompt explicitly selects `evgenii/frontend` as the implementation base and the manifest in this pack as the frontend file-ownership map. If a repository instruction beyond that historical assignment genuinely prevents an action, report the exact conflict to the coordinator; do not silently modify unrelated rules.

## Environment and branch rules

- Follow applicable repository toolchain rules. Use Node through Pixi and the documented WSL worktree convention when required by the target repository.
- Build the common baseline once, under the coordinator, before workers begin. Run any repository-required Anchor/Rust baseline there rather than starting 15 redundant native builds.
- Every worker gets an isolated worktree from the same foundation SHA and a unique `frontend-v2/NN-name` branch.
- Worker code, test, report, and dependency requests are limited to its manifest scope. The coordinator/integrator alone owns shared configuration and dependency locks.
- Preserve all pre-existing modifications. Never reset the dirty macro-research workspace or merge its uncommitted research into the frontend as a convenience.

## Fixed technical and product constraints

- Next.js 15, React 19, strict TypeScript, Tailwind 4, TanStack Query 5, zod 3.
- `@anchor-lang/core` 1.0.2 and `@solana/web3.js` 1.x. No Kit or Codama migration.
- Existing chain account layouts and program instructions are outside this assignment.
- Chain integer accounting stays bigint. Floating-point research and bounded chart coordinates are separate display concerns.
- No private keys, `.env` contents, or RPC credentials in commits, prompts, logs, screenshots, or client bundles.
- User-facing vocabulary: position, cover, forecast. Avoid the project's prohibited product terminology.
- Browser data reads use the application API through `fetchJson`; wallet connection is address access, not transaction execution.
- No remote push, PR merge, deployment, paid service provisioning, or messaging teammates is part of a worker assignment.

## Changes to shared decisions

The coordinator versions [interfaces](interfaces.md). A worker needing an incompatible change sends its concrete proposal, affected consumers, and migration to the coordinator. Only the coordinator publishes a new foundation/checkpoint. A worker does not silently redefine a shared field, add a fallback response, or edit another worker's module.

Workers can commit their own changes locally for integration. They do not cherry-pick siblings into their branch without a coordinator-issued checkpoint. Handoffs include commit SHAs; working-directory copies are not an integration protocol.
