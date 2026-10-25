# Agent 08 — UI foundations

## Mission

Turn the existing `@macropaths/ui` kit into the shared warm-light visual system. Deliver production components with meaningful loading, empty, unavailable, and partial-data states so screen agents can work in parallel. This is a presentational package: it must not fetch data, decode accounts, create wallet connections, or perform settlement arithmetic.

## Read before editing

Read the repository's applicable `AGENTS.md`, then `../README.md`, `../interfaces.md`, `../design-system.md`, `../product-and-content.md`, `../parallel-execution.md`, and `../acceptance.md`. Read `.claude/skills/macropaths-delivery/SKILL.md` and `.claude/skills/macropaths-ui/SKILL.md` when those files are present. Treat `../interfaces.md` at `foundationSHA` as the frozen component contract.

## Exclusive ownership

- `packages/ui/src/**`, except `index.ts`, `charts.tsx`, and `glow-chart/**`.
- `packages/ui/src/styles.css`; you are its only writer.
- `web/test/ui-primitives/**`.

Agent 09 owns chart implementation and chart-local styles. Agent 15 owns package manifests, dependencies, package exports, root imports, global application CSS, and integration wiring. Request changes to those files through the orchestrator. Do not edit page routes, shared query files, or another agent's test directory.

## Startup and parallel workflow

Start from the orchestrator's `foundationSHA`, after actual shared declarations, fixtures, and dependency configuration exist. Build against frozen props immediately; do not wait for API agents. Use fixture demonstration data in tests only. Notify the orchestrator before changing any public prop shape. Keep old exports working until Agent 15 completes legacy-route migration.

## Design implementation

- Use canvas `#F2F1F5`, cards `#FAFAFC`, raised surfaces `#FFFFFF`, text `#1B1B1F`, secondary text `#5F626E`, primary buttons `#315CF5`, positive text `#117653`, and negative text `#B63749`.
- Support the dark chart surface `#101722` without turning the entire card hierarchy dark. Chart appearance is implemented by Agent 09.
- Use the frozen `--mp-*` token names, a 4/8 px spacing rhythm, approximately 20 px card radii, pill controls, tabular figures, and restrained borders/shadows.
- Keep body text readable at 14–16 px; use 12–13 px metadata and 40–48 px hero figures only where hierarchy calls for them. Values inferred from screenshots are estimates, not recovered original CSS.
- Extend semantic primitives rather than adding a second component system. Include Card, Button, IconButton, StatusPill, SegmentedControl, Skeleton, EmptyState, ErrorState, PartialDataNotice, and the agreed data/holding display primitives.
- Status must be expressed in words and accessible names, not color alone. Directional color describes signed wallet movement, not a product being intrinsically good or bad.
- Ensure composition bars render a truthful zero/empty state and carry textual labels/values. Do not set a misleading minimum visual width on zero-valued segments.

## Package boundary

The kit receives display-ready props. Preserve existing `session.ts` exports for compatibility, but do not expand its raw Anchor adapter into the new client architecture. New API-to-view adaptation belongs in feature-owned web modules. Tell Agent 15 which legacy adapter consumers remain so it can remove or migrate them after the developer console is preserved.

Agents 11–14 own feature-specific holding layouts and their CSS modules unless the frozen component contract explicitly assigns a reusable primitive here. Do not absorb route-specific logic into the kit.

## Accessibility and state behavior

- Buttons have explicit types and disabled/busy semantics; icon-only controls have accessible labels.
- Forms retain visible labels and errors. Focus rings must be visible on pale and inverse surfaces.
- Dialog/disclosure primitives expose correct roles, state, focus behavior, and Escape handling where applicable.
- Skeletons reserve meaningful geometry and do not announce dozens of meaningless elements to assistive technology.
- Unavailable data is distinct from empty data. Never turn unavailable values into zero.
- Respect reduced motion and usable touch targets. No hover-only information.
- Keep primary text and control contrast compliant across all component variants, including disabled explanation text.

## Verification

Test observable behavior: focusability, labels, disabled actions, disclosure state, error retry callbacks, empty/partial rendering, zero composition, and long amounts. Use the available test setup in the foundation; request missing dependencies through Agent 15.

Check representative layouts at 375, 768, and 1440 px in the supplied preview harness. Supply screenshots of cards, controls, statuses, and all data states. Browser-test configuration belongs to Agent 15; add component tests only under your owned test directory.

## Done when

- The frozen primitive exports and props are implemented without server or wallet dependencies.
- Shared CSS is the single source of component tokens, and no chart-specific selector overwrites Agent 09's implementation.
- Legacy exports still compile, or the orchestrator has approved a coordinated replacement.
- Long text, large formatted amounts, keyboard focus, and partial data remain usable on mobile.
- Tests pass and screenshots are included in the handoff.

## Handoff

Report branch, base SHA, commit SHA when commits are authorized, changed exports, screenshots, checks run, and exact integration requests. Submit export/import requests to Agent 15; do not edit its files. Record any contract discrepancy rather than silently changing props.
