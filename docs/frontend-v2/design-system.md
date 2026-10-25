# Design system

Apply the user's supplied UI-fragment-extractor method to the screenshots: infer hierarchy, components and visual rhythm, then map them to reusable tokens. The optional analyzer guide is an integration specification, not an installed service. No exact pixel extraction was performed. All screenshot-derived values below are **estimated**; calculated contrasts are identified separately.

## Reference synthesis

- AERIS: calm off-white canvas, rounded banking cards, generous space and restrained pills.
- Transaction-ledger references: readable action rows, clear alignment and quiet separation.
- Revolut-style chart: thin line, few labels, simple controls and uncluttered plot.
- Final dashboard reference: primary chart plus useful adjacent figures. Adapt its organization to a light application with dark chart insets.

Do not reproduce irrelevant payment cards, merchant data, decorative 3D imagery, or fake banking functionality. This app's hero asset is its real inflation path.

## Estimated tokens

```css
:root {
  --mp-bg: #f2f1f5;
  --mp-surface: #fafafc;
  --mp-surface-raised: #ffffff;
  --mp-text: #1b1b1f;
  --mp-muted: #5f626e;
  --mp-border: rgba(24, 24, 30, .08);
  --mp-primary: #315cf5;
  --mp-primary-ink: #ffffff;
  --mp-chart-bg: #101722;
  --mp-path: #6f9fff;
  --mp-chart-muted: #a4b1c5;
  --mp-up: #117653;
  --mp-down: #b63749;
  --mp-radius-card: 20px;
  --mp-radius-control: 12px;
  --mp-radius-pill: 999px;
}
```

Geist via next/font. Space scale: 4, 8, 12, 16, 24, 32, 48 px. Body 14–16 px, metadata 12–13 px, card headings 16–18 px, page headings 28–36 px, hero numbers 40–48 px. Tabular numerals for amounts. Dark primary text, sparse bold weights and no full-screen white canvas.

Calculated sRGB contrast: #5F626E on #F2F1F5 ≈5.40:1; white on #315CF5 ≈5.28:1; #6F9FFF on #101722 ≈6.92:1; #117653 on #FAFAFC ≈5.39:1; #B63749 on #FAFAFC ≈5.55:1. Verify actual composite/disabled/focus states in the browser; these calculations do not certify every component.

## Layout

Desktop max content width about 1280 px; compact left navigation, light top bar, clear page title and flexible bento/grid. Session hero approximately 2:1 chart to adjacent results. Never give every raw field a visually equal tile. Use at most three headline numbers in a single group.

At 375 px: 16 px outer spacing, one column, adaptive chart labels, wrapping controls and bottom navigation with safe-area inset. No horizontal overflow hidden as a substitute for fixing layout. At 768 px: adaptive two-column cards. At 1440 px: comfortable whitespace without excessive empty areas.

Use CSS modules for feature layout. Worker 08 alone owns kit global styles. Worker 09 owns chart CSS modules. Worker 15 owns application global imports/aliases. Feature agents must not introduce another token system.

## Component contracts

Retain existing kit Card/Button/StatusPill APIs where possible. Add accessible Skeleton, EmptyState, ErrorState and partial-data notice patterns. Avoid duplicating bespoke buttons/cards in each page. Holding content can be assembled in feature adapters from primitives; account/domain decoding stays outside the kit.

Controls have visible focus, semantic labels and comfortable touch targets (aim for at least 44 px). Client navigation uses links with aria-current, not tab roles unless it controls actual panels. My activity/Market and chart range controls implement their actual semantics. No icon-only controls without accessible names.

Positive/negative text describes money-flow direction and is paired with signs/labels. CPI rising is not automatically green or good. Do not color all higher scores as profit.

## Charts

- Single 1.5 px primary line in the hero, distinct blurred duplicate beneath it, Gaussian stdDeviation around 5.
- Area fill from at most 8% opacity to zero. Highlight readings above the threshold with a restrained clipped fill.
- No gridlines; approximately 3–5 muted labels per axis group where space permits. Dashed threshold with plain units.
- Monotone interpolation through observed points without overshooting values. No future flat extension, invented observations or smoothing that changes displayed sample values.
- Shading illustrates threshold excess; the score uses the exact monthly recursion, not integration of the drawn curve.
- Crosshair/value bubble on pointer/touch; keyboard navigation through observations. Clamp tooltip inside the card.
- Chart title, textual summary and an accessible expandable observation list. Chart data must remain understandable without hover.
- Unique IDs for SVG filters/gradients; non-scaling stroke; ResizeObserver with stable initial layout.
- Entrance draw-in and control transitions are subtle and respect prefers-reduced-motion. Avoid animating the same historical path on every polling refresh.
- Sparklines show the relevant product's accrued-score path if labelled as a product score, rather than relabelling the same CPI series as different products.
- Planner x-axis is budget/stake allocation. It is not a date axis. Primary blue and secondary muted series need labels and distinct stroke treatment.

## Assets and verification

Use next/font Geist and existing inline SVG icons; no external photo/3D asset is required. Reference screenshots are inspiration rather than recovered code. The documentation pack does not contain licensed copies of screenshots.

If screenshots are available to the executor, retain the user-provided images as reference inputs and compare hierarchy, density and chart treatment. If not, use this explicit spec and record that direct reference comparison was unavailable. Do not invent image paths.

Required screenshots: Dashboard disconnected and connected; Session A; partial Activity; Products/Planner at 375×812 and 1440×900. Add 768×1024 layout checks. Verify reduced motion, keyboard/focus, skeleton/empty/error, long numbers, and no clipped tooltips. Report actual verification, not just build success.
