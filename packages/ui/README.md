# @macropaths/ui

Presentational React components extracted from the six reference screenshots: Capsule (dark crypto dashboard), BTC mobile chart, the bank app phones, and AERIS (light desktop dashboard). The look is visually similar to the references, not a copy of their code. Colours and sizes are estimates.

The kit owns no routing, wallet or fetching. The web app owns those, and passes data in through props.

## Use

```ts
// web/src/app/layout.tsx
import "@macropaths/ui/styles.css";
// <html data-theme="light"> (AERIS look) or "dark" (Capsule look); wrap the body in class "mp-root".

import { PathChart, StatCard, session as S } from "@macropaths/ui";
```

Next.js needs `transpilePackages: ["@macropaths/ui"]` because the package ships TypeScript source. Peer dependency: React 18 or newer. No other dependencies, no Tailwind requirement, icons are inline SVG.

## Catalog

| Component | Source screenshot | What it shows from the backend |
|---|---|---|
| `Sidebar`, `PromoCard` | Capsule left column | App sections; footer notice such as "Devnet, test tokens only" |
| `IconRail` | AERIS left rail | Compact section switcher |
| `TopBar`, `SearchField` | Capsule and AERIS headers | Slots for tabs, session search, wallet button, network badge |
| `PillTabs` | AERIS top tabs | Screen A, B, C switch |
| `PageHeader` | AERIS breadcrumb and title | Session breadcrumb, page actions |
| `SegmentedControl` | Bank app W/M/6M/All | Path range by year |
| `FilterChips` | AERIS queue filters | Planner policy filter, position filter |
| `Button`, `IconButton`, `Badge`, `StatusPill` | AERIS and bank app | Actions; `StatusPill` tones map to `SessionState` |
| `Avatar`, `AvatarStack` | AERIS payees and header | Participant wallets |
| `Card`, `CardArrow`, `Bento` | AERIS tiles | Layout of every screen |
| `StatCard`, `Sparkline` | Capsule KPI row | `peak`, `max_decline`, `excess_acc`, latest value |
| `PathChart` | Capsule price chart, BTC mobile reference line | `values[48]` against `k`; excess shaded; replay cursor at `next_index` |
| `BarChart` | Bank app Expenses | Excess per year, planner TailLoss95 |
| `MiniBars` | AERIS Activity | Observations or positions per bucket |
| `Meter` | AERIS Wallet bars | `scores[p] / 1e6`, replay progress, claims progress |
| `ChangeList` | Capsule BTC change list | Scores per product |
| `CompositionBar`, `LegendRow` | AERIS Spend composition | `side_totals[4]` |
| `DataTable`, `EntityCell` | Capsule Market, AERIS Approval queue | Sessions, positions, the 21 planner policies |
| `ActivityFeed` | Bank app Transaction history | Deposit, Observed, Settled, Claimed events with explorer links |
| `BalanceCard`, `AccountPill` | Bank app balance card | PLAY balance and position of the connected wallet |
| `HeroCard` | AERIS Treasury card | Planner recommendation |
| `SessionCard` | AERIS virtual card | Session id, total locked, deadline, state |
| `SummaryCtaCard` | AERIS Awaiting approval | Screen C claim card calling `claim` |

## Session adapters

`session.ts` converts a fetched `Session` account (Anchor camelCase, BN or bigint) into props: `pathPoints`, `thresholdLine`, `yearTicks`, `peakIndex`, `headlineStats`, `scoreFractions`, `scoreRows`, `sideSegments`, `totalLocked`, `replayProgress`, plus formatters and `explorerUrl`.

Units were checked against the settled reference session `B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju` on devnet: values and `k` are 1e-4 pp, scores are 1e6 (0.827387 and 0.863980), side totals are PLAY base units with 6 decimals.

Use the IDL from `origin/cursor_main`. It has `n_obs` and `next_index` as u32 and a 64-byte `_reserved` tail; an older local copy with u8 fields decodes the account wrongly.

Open points:
- `SIDE_LABELS` ("Protection", "Counterparty") is an assumption from the planner brief. Confirm with the program owner.
- Copy rule from the planner brief: never write bet, option, insurance or fair value.
