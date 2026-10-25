# Contract for your launcher script

This pack provides prompts and a machine-readable manifest. It does not require a particular Claude CLI or SDK. No supported Claude executable was found on the authoring environment's PATH, so no unverified command-line flags are embedded here. Bind the runner to your installed Claude interface and test it with a single harmless prompt before launching implementation.

## Inputs

- Absolute repository path containing `evgenii/frontend` history.
- The integration worktree path and FOUNDATION_SHA prepared by the coordinator.
- Worker worktree parent directory outside the dirty source worktree.
- `docs/frontend-v2/launch-manifest.json`.
- An adapter that accepts a working directory and prompt text/file, captures stdout/stderr and returns process status. Supply any model/concurrency flags according to the actual installed client.
- An output directory for runner state and logs, excluded from git.

## Manifest semantics

`workers` contains exactly 15 unique IDs. Each has its brief, prompt, branch suffix, owned paths, exclusions, skills, merge dependencies and report path. Every path is repository-relative with `/` separators. A trailing slash means descendants; otherwise match the literal path. Do not interpret brackets as glob expressions. Workers have no execution prerequisites beyond foundationReady; mergeAfter controls integration only.

`shared_edit_owner` is 15 after foundation. The coordinator owns shared modifications during bootstrap. Worker 15 must serialize any package/lockfile changes it makes after launch with coordinator requests.

## Launch sequence

1. Validate every required document, prompt and skill path; reject duplicate IDs/branches, missing ownership, cycles or nonexistent dependency IDs.
2. Confirm `git rev-parse FOUNDATION_SHA` resolves to the recorded commit and each worktree will start there. If the frontend head moved since preparation, re-ground under the coordinator instead of silently resetting or rebasing.
3. Create independent branches/worktrees, preserving existing branches and directories. Refuse name collisions or reuse only after inspecting their state.
4. Prepare dependency installations per worktree without sharing mutable node_modules folders between installs. A package-manager download cache may be shared. Foundation lockfiles are identical; workers cannot rewrite them.
5. Render the common context below plus the worker's prompt. All paths used by the process resolve in that worker's worktree.
6. Launch up to 15 workers immediately. Do not wait on mergeAfter to start them.
7. Save logs and process metadata separately for each worker. Do not echo secrets or environment contents into prompts/logs.
8. On exit, read that worker's report and compare its changed paths against ownership. Validate reported commit exists and descends from the approved foundation/checkpoint.
9. Give worker 15 the completed handoffs; it integrates dependency closures in the documented order and runs full verification. Resume a producer for corrections rather than asking the integrator to rewrite unfinished work wholesale.

## Context to prepend verbatim with runtime values substituted

```text
You are frontend implementation worker {WORKER_ID}: {WORKER_NAME}.
Repository: {WORKTREE_PATH}
Original frontend commit: {ORIGINAL_FRONTEND_SHA}
Foundation commit: {FOUNDATION_SHA}
Branch: {WORKER_BRANCH}
Your brief: {BRIEF_PATH}
Your report: {REPORT_PATH}
Read docs/frontend-v2/frontend-protocol.md and obey your manifest ownership.
All 15 workers start together. Use frozen contracts and test fixtures; do not wait
idle for upstream implementation and do not introduce live-mode mock fallbacks.
Implement your assigned application work, run relevant checks, commit only your
owned files, and finish with an honest report and commit SHA. Do not push/deploy.
```

These are launcher substitution variables, not values to leave unresolved in an executed prompt. Before running a worker, verify every context value is concrete and that its actual cwd/branch/head match the context.

## State machine

```text
bootstrap_pending -> foundation_ready -> worker_running
worker_running -> handoff_ready | needs_attention
handoff_ready -> integrating -> verified | producer_amendment_needed
producer_amendment_needed -> worker_running
verified(all workers + integrated acceptance) -> complete
```

Persist status transitions so a runner restart inspects existing worktrees instead of launching duplicate writers. Do not define complete as merely fifteen exited processes. A worker can hand off focused tests while whole-app checks depend on the integration closure; the final result cannot claim those checks passed until 15 runs them.

## Delivery boundary

The runner and workers may create local worktrees/commits for the requested implementation. No automatic push, remote PR merge, service provisioning or deployment is authorized by this pack. The current documentation-generation task creates none of those processes/worktrees; these instructions are for your later execution.
