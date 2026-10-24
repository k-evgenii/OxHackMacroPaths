# 00 Orchestrator

You merge; you do not write program code. Everything you need to decide is written down: the spec in `docs/program-spec.md`, the protocol in `agents/README.md`, each agent's scope in its brief.

## Steps

1. Run the Setup block in `agents/README.md`: fifteen worktrees, two skills. Create `docs/merge-log.md` with the header `| agent | sha | build | tests | reviewer |`.
2. Open one Cursor window per worktree. First message to every agent, verbatim:
   > Read AGENTS.md, docs/program-spec.md and agents/NN-name.md. Follow the Steps in order. Do not change files outside "Files you own". When done, open a PR using the template in agents/README.md and post the Hand-off line in chat.
3. **Wave 0.** Start 01, 02, 03 at once. Merge 02 first (pure Rust, no shared-file edits), then 03, then 01. Run the merge checklist on each. Post `cursor_main moved: 02-math 03-chain 01-skeleton`.
4. **Wave 1.** Start 04–09. Merge in PR-arrival order. Expect union conflicts in `lib.rs`, `instructions.rs`, `error.rs`; resolve by keeping every line. After the last merge post `cursor_main moved: 04..09`.
5. **Gate G1 (target H6).** Run agent 10's one-product lifecycle test yourself (or ask 10 to run it first). Green: start 10 and 11. Red: start 10 and 11 anyway, announce `gate G1 fail`, and cancel 12 and 13.
6. **Gate G2 (target H10).** 10's full lifecycle test reports `827387 / 863980`, 11's report has no open critical row. Pass: start 12 and 13, announce `gate G2 pass`. Fail: skip 12, 13 and 14's seller subcommands, announce `gate G2 fail: base only`.
7. **Wave 4.** Start 14 as soon as 10 merges. Start 15 after 11 and 14 merge. Hand 15 the shared program keypair out of band (never in git or chat).
8. After 15: `git tag v0.1-devnet`, post program ID and session address to the team. Freeze at H18; after the freeze merge only fixes for a failed rehearsal.
9. Chat discipline: `cursor_main moved: …`, `gate G1 pass|fail`, `gate G2 pass|fail`, `freeze`. Nothing else from you in the channel.

## Merge checklist (copy from agents/README.md, run every time)

```
git checkout agent/NN-name && git rebase cursor_main
anchor build
cargo test -p macropaths
pixi run vectors            # D=66191 A=691184 827387 863980
git diff cursor_main --stat        # only the brief's files
git checkout cursor_main && git merge --no-ff agent/NN-name
echo "| NN-name | $(git rev-parse --short HEAD) | ... |" >> docs/merge-log.md
```

## When an agent asks a question

If the answer is in `docs/program-spec.md`, reply with the section number. If it is not, decide, add one sentence to the spec in `cursor_main`, commit it as `spec: …`, and post `cursor_main moved: spec`. The spec is the only place decisions live.
