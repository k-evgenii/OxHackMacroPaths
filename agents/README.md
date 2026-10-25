# Agent protocol

**Integration branch is `cursor_main`.** Agents branch from it and PRs target it. `main` is the team's shared branch; the orchestrator merges `cursor_main` into `main` at the gates, never the other way round mid-wave.

Fifteen agents, one orchestrator. Each agent has a brief `agents/NN-name.md`, a branch `agent/NN-name`, and a WSL worktree `~/wt/NN-name`. The specification every brief points at is `docs/program-spec.md`. The orchestrator's own checklist is `agents/00-orchestrator.md`.

## Setup (orchestrator, once)

```bash
cd ~/OxHackMacroPaths && git checkout cursor_main && git pull
for b in 01-skeleton 02-math 03-chain 04-create-session 05-deposit 06-lock-expire 07-observe 08-settle 09-claim-sweep 10-lifecycle 11-security 12-seller-accounts 13-cover 14-keeper-bridge 15-deploy; do
  git worktree add ~/wt/$b -b agent/$b cursor_main
done
```

Skills and the Solana MCP server are committed in the repo (`.cursor/skills/`, `.cursor/mcp.json`), so every worktree has them with no install step. Cursor also reads `~/.agents/skills/solana-dev`, which the Solana installer drops on each machine; its default-stack advice (Kit, web3.js v3, Codama) is overridden by `.cursor/skills/solana-anchor-reference/SKILL.md`.

## Setup (each agent, in its worktree, before step 1)

```bash
cd ~/wt/NN-name
pixi install --locked
anchor build --ignore-keys && cargo test -p macropaths     # must be green before you start; see AGENTS.md on the keypair
```

First build takes about three minutes per worktree; `target/` is per worktree and is never committed.

## Waves

An agent starts when the branches listed under "May assume merged" in its brief are in `cursor_main`. After each merge the orchestrator posts `cursor_main moved: <branches>`; every agent still working then runs `git rebase cursor_main`.

| Wave | Agents | Start condition |
| --- | --- | --- |
| 0 | 01 skeleton, 02 math, 03 chain | now, in parallel |
| 1 | 04 create_session, 05 deposit, 06 lock-expire, 07 observe, 08 settle, 09 claim-sweep | 01 merged (07 also needs 02, 03; 08 and 09 need 02) |
| 2 | 10 lifecycle, 11 security | 04–09 merged |
| 3 | 12 seller-accounts, 13 cover | 10 merged and gate G2 declared |
| 4 | 14 keeper-bridge, 15 deploy | 10 merged (14's seller callers wait for 13; 15 waits for 11 and 14) |

Gates: **G1** = agent 10's one-product lifecycle test green. **G2** = full lifecycle reports scores `827387 / 863980` and agent 11's report has no open critical item. If G2 fails, wave 3 is skipped and the submission is the base pool plus advisory forecasts.

## Pull request template

```
Branch: agent/NN-name
Built: <one paragraph>
Acceptance:
  $ <command>
  <last lines of output, verbatim>
Files touched: <list; must match "Files you own" in the brief>
Open questions: <none, or a list>
```

One PR per agent. Force-push allowed on your own branch only.

## Merge checklist (orchestrator)

1. `git rebase cursor_main` on the agent branch; agent resolves conflicts if any.
2. `anchor build --ignore-keys` (plain `anchor build` once the shared keypair is in `target/deploy/`)
3. `cargo test -p macropaths`
4. `pixi run vectors` prints `D=66191 A=691184 827387 863980`
5. `git diff cursor_main --stat` touches only the brief's files (plus union additions to shared files)
6. `git merge --no-ff agent/NN-name`
7. Append a line to `docs/merge-log.md`: `NN-name | <sha> | build <s> | <tests> passing | reviewed by <name>`
8. Post `cursor_main moved: NN-name`

## Conflict rules

- `lib.rs`, `instructions.rs`, `error.rs`, `events.rs`: many agents add to them. Resolve by union; never drop or reorder a line that is not yours.
- `state.rs`: agents 01 and 12 only. `constants.rs`: agent 01 only. Need a field, constant or error variant? Post in chat; the orchestrator adds it to `cursor_main` and announces it.
- `Cargo.lock`: regenerate with `anchor build` after a rebase, commit the result.

## Tooling

| Tool | Used by | Notes |
| --- | --- | --- |
| `litesvm` 0.10, `litesvm-token` | all Rust tests | in-process SVM, no validator; token helpers for mint/ATA |
| `serde_json`, `proptest` (dev-deps) | 02, all tests | read `vectors.json`; 10,000-case conservation property |
| `.cursor/skills/solana-anchor-reference` | all | Anchor 1.0 patterns, testing, Surfpool, common errors, compatibility matrix (vendored from `solana-foundation/solana-dev-skill`, MIT) with the team's stack pinned in its `SKILL.md` |
| `.cursor/skills/solana-vulnerability-scanner` | 11 | Trail of Bits audit checklist, six Solana-specific vulnerability classes (CC BY-SA 4.0) |
| `.cursor/mcp.json` → `https://mcp.solana.com/mcp` | all | Solana docs lookup from inside the agent; restart Cursor after cloning so it loads |
| `.cursor/rules/program.mdc`, `AGENTS.md` | all | project rules; model-independent, loaded for Grok, Claude or any Cursor model |
| Surfpool 1.6 | 10, 14, 15 | local Surfnet for TS integration and the keeper |
| `@anchor-lang/core` 1.0.2 + `@solana/web3.js` v1 | 10, 14 | the team's TS stack; no Kit, no Codama |

Not used: Trident, Metaplex, Token-2022, oracle crates.
