---
name: macropaths-ui
description: Build or review MacroPaths client screens with warm light banking surfaces, dark thin glowing charts and the approved cover-buyer information hierarchy. Use for UI kit, shell, charts, pages and visual QA.
---

# MacroPaths client UI

Read [design-system](../../../docs/frontend-v2/design-system.md), [product content](../../../docs/frontend-v2/product-and-content.md), and your role's [interfaces](../../../docs/frontend-v2/interfaces.md). Use the existing UI kit; feature agents do not create a parallel primitive/token system.

## Visual intent

Warm gray-lilac canvas #F2F1F5, near-white cards #FAFAFC, dark text #1B1B1F, readable muted text #5F626E. Dark chart canvas #101722, electric-blue line #6F9FFF, accessible blue button #315CF5. Geist, tabular numerals, generous 4/8 px rhythm, rounded cards. Reference-derived values are estimates; do not claim measured screenshot extraction.

The optional UI Analyzer setup document does not install an analyzer. Follow the supplied fragment-extractor method for layout/colors/type/components/effects, but don't invent exact pixel measurements, source fonts or hidden interactions.

## Information hierarchy

One principal figure per card; at most three headline figures grouped together. Covers first, pool positions separately. Explain historical replay/devnet/test PLAY. Raw hashes, counters and fit parameters move to /dev; understandable terms/source explanations remain accessible to users.

Use state-aware amount labels from shared exact models. Last replay reading includes its month. Scores are not returns/probabilities. Unknown balances, dates, amounts or offers stay unknown. Fuel is Research. No fiat conversion or actionable transaction flow is invented.

## Chart rules

1.5 px crisp primary line over a separate softly blurred copy, at most 8% area opacity, sparse muted ticks and a dashed threshold. Smooth through actual samples without overshooting; null observations are gaps. Plot values are display numbers; exact tooltip strings arrive from adapters. Never extend a line into unobserved months.

Pointer/touch/keyboard selection, bounded tooltip, unique SVG filter IDs, reduced-motion support, accessible summary and observation list are required. Hero has one main series. Planner plots allocation versus historical shortfall rather than inventing a timeline. Sparklines must match their labelled statistic.

## Boundaries and evidence

Worker 08 owns kit global CSS; 09 owns chart modules; 10 owns queries/wallet context; pages own only feature adapters and CSS modules. Ask the owner for a shared change. Read-only wallet data comes through API queries, never browser RPC.

Verify 375×812, 768×1024 and 1440×900; long amounts/names, focus, keyboard, reduced motion, error/loading/empty/partial states and no clipped tooltips. Capture actual screenshots and describe any unverified reference comparison. A build pass is not visual QA.
