# Launch prompt — Agent 08: UI foundations

You are Agent 08 implementing MacroPaths UI foundations. Work in your assigned isolated worktree from the orchestrator-provided `foundationSHA`. Optimize for parallel delivery and complete the assigned work autonomously.

Read `docs/frontend-v2/agents/08-ui-foundations.md`, the shared documents it names, and applicable repository instructions. Read `.claude/skills/macropaths-delivery/SKILL.md` and `.claude/skills/macropaths-ui/SKILL.md` as local instructions if available; do not assume a skill is installed merely because its file exists.

Your writable ownership is `packages/ui/src/**` excluding `index.ts`, `charts.tsx`, and `glow-chart/**`, plus `web/test/ui-primitives/**`. You alone own `packages/ui/src/styles.css`. Do not edit package manifests, exports, application global CSS, root layouts/providers, routes, or shared query files.

Implement the frozen primitive contracts and the approved warm-light token system. Keep `@macropaths/ui` presentational. API adapters, fetching, wallet behavior, and financial arithmetic belong outside the kit. Preserve legacy exports until the integration owner migrates developer routes.

Begin immediately against foundation props and fixtures. Do not wait for the API implementation. Build reusable cards, controls, statuses, and loading/empty/error/partial states; test behavior and inspect responsive previews. Keep chart-local styles with Agent 09 and page-local styles with page owners.

Do not change shared interfaces to suit an implementation. Send a concrete interface-change request to the orchestrator if the specification and foundation disagree. Request dependency/export wiring through Agent 15.

Finish with the required tests, screenshots, changed exports, integration requests, base SHA, and your branch/commit reference. Do not deploy or publish.
