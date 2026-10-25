# Report 01 — Contracts and exact data models

Branch `frontend-v2/01-contracts-and-models`, based on foundation `85a62e8`.

## Changes

- `packages/client/src/scalars.ts` (new): the browser-safe constants `N_OBS`, `ONE`, `PLAY_DECIMALS`, `PRODUCT_NAMES` and `SIDE_NAMES`. `constants.ts` re-exports them, so existing export names and values are unchanged.
- `packages/client/src/math.ts`: imports `ONE` from `./scalars` instead of `./constants`.
- `packages/client/test/contracts-hardening.test.ts` (new, 14 tests).

No public signature changed. Fixtures were not modified, and all of them already parse against their schemas.

## Defect found and fixed

**The presentation entry point was not browser-safe.** The import chain was `presentation.ts` → `math.ts` → `constants.ts`, and `constants.ts` loads `@solana/web3.js` (`PublicKey`) and `idl.json`. Any page importing `@macropaths/client/presentation` therefore loaded web3.js and the IDL. After the fix, the transitive runtime imports of `types`, `format`, `presentation`, `math` and `scalars` include no `@solana/*`, `@anchor-lang/*`, IDL, decode, view, pdas, constants, the index module or `node:*`. A test enforces this.

## Verified by tests

- **Running:** the illustration is built from `calculateAccruedScores`, which calls `score` on `maxDecline`/`dCap` and `excessAcc`/`aCap`. It then computes temporary `budgets(sideTotals, scores)` and `claimAmount`, using values above 2^53. The test also checks that the stored zero budgets would give a different, wrong answer. Cover illustrations use `coverPayout`, and `unclaimed` stays null.
- **Open, and Running with `nextIndex === 0`:** both are `undetermined`, with a null amount and a null `unclaimedTotal`.
- **Settled:** amounts are the exact sums of the view's payout fields. A claimed holding keeps its historical amount, has `unclaimed` set to `"0"` and contributes zero to the total. If any held, unclaimed amount is undetermined, `unclaimedTotal` is null. With no holdings it is `'0'`.
- **Refunding:** amounts are the deposits or premiums. A claimed refund contributes zero.
- **Cover:** `maximumPayout` is the exact sum of `units`, including values above 2^53.
- **`sumAmounts`:** rejects non-integer strings.
- **Formatters:** percent, percentage points, pp·months, point-months and PLAY each produce distinct output. A negative value that rounds to zero prints `0.00 pp`, not `-0.00 pp`. Very large values stay exact, and digits are clamped to the scale.
- **`parseEvents` on encoded Anchor logs:** the test uses one transaction with events for two sessions (Claimed B, Claimed A with u64 max, CoverBought B). Each event keeps the emitted session. `eventIndex` is 0, 1, 2 in log order and keeps its value after session filtering. Parsing is deterministic.
- **Event schema:** every EventView branch is rejected when `session` or `eventIndex` is missing, or when `eventIndex` is negative.
- **Reference session A:** the existing tests check the terms (`40000`/`80000`/`800000`), scores (`827387`/`863980`) and 380 PLAY of pool contributions, and confirm research p90 caps do not replace them.

## Checks run

From `packages/client`, run via WSL with node 24 (`npm ci`, then `npx vitest run`):
- 3 test files, 75 tests, all passed (14 new, 47 fixture contract tests, 14 existing client tests).
- `npx tsc --noEmit` passed.

The research bundle hash test silently skips under WSL, because the worktree's `.git` file points to a Windows path. I checked the hashes on the Windows side instead: the SHA-256 of `HEAD:web/public/data/{manifest,forecast,planner}.json` matches `research/bundle.json`.

## Proposals for the orchestrator and Agent 15 (not applied)

1. **Agent 15, package exports:** optionally add `"./math": "./src/math.ts"` (pure math with no web3 dependency) to `packages/client/package.json`. The existing `./presentation` subpath already exposes the helpers and the new formatters.
2. **Test-only issue:** the hash test returns early, without saying so, whenever `git` fails, so under WSL it passes without checking anything. Consider running it with the CI git toolchain or marking it as skipped. This is a test I own, but I left it as it is to keep the foundation contract test stable.
3. **Interface wording:** the frozen text says `unclaimedTotal` is null "when an unclaimed holding has an undetermined amount". The implementation also returns null when a holding has a Running *illustration*, because `unclaimed` is null there. I consider that correct, since an illustration is not claimable, but `interfaces.md` should say so explicitly.
